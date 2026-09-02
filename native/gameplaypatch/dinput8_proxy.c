#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <string.h>

#include "shotgun_sprint_state.h"

/*
 * Dedicated ROTK gameplay patch.
 *
 * The stock client imports only DirectInput8Create from dinput8.dll. This
 * proxy forwards that call to the absolute System32 DLL, then starts one
 * bounded worker outside DllMain. Vivox remains a completely separate binary.
 */

#define ROTK_H1Z1_FILE_SIZE UINT64_C(82158616)
#define ROTK_H1Z1_TIMESTAMP UINT32_C(0x5D56E9AB)
#define ROTK_H1Z1_IMAGE_SIZE UINT32_C(0x072B4000)

#define ROTK_ANTI_SLOW_SIGNATURE_RVA UINT32_C(0x1046F8D)
#define ROTK_ANTI_SLOW_PATCH_OFFSET 11U
#define ROTK_RESUME_HOOK_RVA UINT32_C(0x1A90D16)
#define ROTK_RESUME_RETURN_RVA UINT32_C(0x1A90D30)
#define ROTK_LEGACY_CANARY_RVA UINT32_C(0x1A91148)

#define ROTK_CONTROLLER_PLAYER_OFFSET UINT32_C(0x338)
#define ROTK_CONTROLLER_SPRINT_OFFSET UINT32_C(0x341)
#define ROTK_PLAYER_ACTION_TIMER_OFFSET UINT32_C(0x3B64)

#define ROTK_PATCH_WAIT_ITERATIONS 300U
#define ROTK_PATCH_WAIT_MS 100U
#define ROTK_STUB_CAPACITY 256U

typedef HRESULT(WINAPI *direct_input8_create_fn)(
    HINSTANCE,
    DWORD,
    REFIID,
    LPVOID *,
    void *);
typedef HRESULT(WINAPI *hresult_no_args_fn)(void);
typedef HRESULT(WINAPI *dll_get_class_object_fn)(
    const void *,
    const void *,
    LPVOID *);
typedef const void *(WINAPI *get_joystick_format_fn)(void);

static INIT_ONCE g_system_dinput_once = INIT_ONCE_STATIC_INIT;
static HMODULE g_system_dinput = NULL;
static direct_input8_create_fn g_direct_input8_create = NULL;
static hresult_no_args_fn g_dll_can_unload_now = NULL;
static dll_get_class_object_fn g_dll_get_class_object = NULL;
static hresult_no_args_fn g_dll_register_server = NULL;
static hresult_no_args_fn g_dll_unregister_server = NULL;
static get_joystick_format_fn g_get_joystick_format = NULL;
static volatile LONG g_patch_worker_started = 0;
static volatile LONG g_sprint_state = 0;

static const BYTE k_anti_slow_signature[] = {
    0x44, 0x8B, 0x87, 0x64, 0x3B, 0x00, 0x00, 0x45,
    0x85, 0xC0, 0x0F, 0x8F, 0x9E, 0x00, 0x00, 0x00,
    0x83, 0xBF, 0xA0, 0x09, 0x00, 0x00, 0x02,
};
static const BYTE k_resume_original[] = {
    0x0F, 0xB6, 0x9E, 0x41, 0x03, 0x00, 0x00,
};
static const BYTE k_resume_signature[] = {
    0x0F, 0xB6, 0x9E, 0x41, 0x03, 0x00, 0x00,
    0xF6, 0xC3, 0x40, 0x74, 0x09, 0xC0, 0xEB, 0x07,
    0xEB, 0x09, 0x32, 0xDB, 0xEB, 0x05,
    0x0F, 0xB6, 0x5C, 0x24, 0x34,
};

static void debug_status(const char *message) {
    OutputDebugStringA(message);
}

static FARPROC system_dinput_export(const char *name) {
    return g_system_dinput == NULL
        ? NULL
        : GetProcAddress(g_system_dinput, name);
}

static BOOL CALLBACK load_system_dinput(
    PINIT_ONCE once,
    PVOID parameter,
    PVOID *context) {
    WCHAR path[MAX_PATH];
    static const WCHAR suffix[] = L"\\dinput8.dll";
    UINT length;
    FARPROC address;

    (void)once;
    (void)parameter;
    (void)context;

    length = GetSystemDirectoryW(path, ARRAYSIZE(path));
    if (length == 0U ||
        length >= ARRAYSIZE(path) ||
        length + ARRAYSIZE(suffix) > ARRAYSIZE(path)) {
        return TRUE;
    }
    CopyMemory(path + length, suffix, sizeof(suffix));
    g_system_dinput = LoadLibraryW(path);
    if (g_system_dinput == NULL) {
        return TRUE;
    }
    address = system_dinput_export("DirectInput8Create");
    if (address != NULL) {
        union {
            FARPROC source;
            direct_input8_create_fn destination;
        } converted;
        converted.source = address;
        g_direct_input8_create = converted.destination;
    }
    {
        union {
            FARPROC source;
            hresult_no_args_fn destination;
        } converted;
        converted.source = system_dinput_export("DllCanUnloadNow");
        g_dll_can_unload_now = converted.destination;
        converted.source = system_dinput_export("DllRegisterServer");
        g_dll_register_server = converted.destination;
        converted.source = system_dinput_export("DllUnregisterServer");
        g_dll_unregister_server = converted.destination;
    }
    {
        union {
            FARPROC source;
            dll_get_class_object_fn destination;
        } converted;
        converted.source = system_dinput_export("DllGetClassObject");
        g_dll_get_class_object = converted.destination;
    }
    {
        union {
            FARPROC source;
            get_joystick_format_fn destination;
        } converted;
        converted.source = system_dinput_export("GetdfDIJoystick");
        g_get_joystick_format = converted.destination;
    }
    return TRUE;
}

static BOOL readable_range(const BYTE *address, SIZE_T size) {
    MEMORY_BASIC_INFORMATION information;
    uintptr_t start = (uintptr_t)address;
    uintptr_t end = start + size;
    uintptr_t region_end;
    DWORD protection;

    if (end < start ||
        VirtualQuery(address, &information, sizeof(information)) !=
            sizeof(information) ||
        information.State != MEM_COMMIT) {
        return FALSE;
    }
    region_end =
        (uintptr_t)information.BaseAddress + (uintptr_t)information.RegionSize;
    if (end > region_end) {
        return FALSE;
    }
    protection = information.Protect;
    if ((protection & PAGE_GUARD) != 0U ||
        (protection & PAGE_NOACCESS) != 0U ||
        protection == 0U) {
        return FALSE;
    }
    return TRUE;
}

static BOOL exact_bytes(
    const BYTE *address,
    const BYTE *expected,
    SIZE_T size) {
    return readable_range(address, size) &&
        memcmp(address, expected, size) == 0;
}

static BOOL restore_page_protection(
    void *address,
    SIZE_T size,
    DWORD protection) {
    DWORD ignored;
    unsigned int attempt;

    for (attempt = 0U; attempt < 3U; ++attempt) {
        if (VirtualProtect(address, size, protection, &ignored)) {
            return TRUE;
        }
    }
    return FALSE;
}

static BOOL validate_h1z1_image(HMODULE module, BYTE **image_base) {
    BYTE *base = (BYTE *)module;
    const IMAGE_DOS_HEADER *dos;
    const IMAGE_NT_HEADERS64 *nt;
    WCHAR executable_path[MAX_PATH];
    HANDLE file;
    LARGE_INTEGER file_size;
    DWORD path_length;
    BOOL valid_size;

    if (base == NULL || !readable_range(base, sizeof(IMAGE_DOS_HEADER))) {
        return FALSE;
    }
    dos = (const IMAGE_DOS_HEADER *)base;
    if (dos->e_magic != IMAGE_DOS_SIGNATURE ||
        dos->e_lfanew <= 0 ||
        dos->e_lfanew > 0x1000 ||
        !readable_range(
            base + dos->e_lfanew,
            sizeof(IMAGE_NT_HEADERS64))) {
        return FALSE;
    }
    nt = (const IMAGE_NT_HEADERS64 *)(base + dos->e_lfanew);
    if (nt->Signature != IMAGE_NT_SIGNATURE ||
        nt->FileHeader.Machine != IMAGE_FILE_MACHINE_AMD64 ||
        nt->FileHeader.TimeDateStamp != ROTK_H1Z1_TIMESTAMP ||
        nt->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC ||
        nt->OptionalHeader.SizeOfImage != ROTK_H1Z1_IMAGE_SIZE) {
        return FALSE;
    }

    path_length =
        GetModuleFileNameW(module, executable_path, ARRAYSIZE(executable_path));
    if (path_length == 0U || path_length >= ARRAYSIZE(executable_path)) {
        return FALSE;
    }
    file = CreateFileW(
        executable_path,
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        NULL,
        OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL,
        NULL);
    if (file == INVALID_HANDLE_VALUE) {
        return FALSE;
    }
    valid_size =
        GetFileSizeEx(file, &file_size) &&
        file_size.QuadPart == (LONGLONG)ROTK_H1Z1_FILE_SIZE;
    CloseHandle(file);
    if (!valid_size) {
        return FALSE;
    }

    *image_base = base;
    return TRUE;
}

__declspec(noinline) static DWORD WINAPI shotgun_sprint_hook_step(
    BYTE *controller) {
    BYTE *player;
    int timer_positive;
    int shift_down;
    shotgun_sprint_step_result result;
    uint8_t state;

    if (controller == NULL) {
        InterlockedExchange(&g_sprint_state, 0);
        return 0U;
    }
    shift_down = (GetAsyncKeyState(VK_SHIFT) & (SHORT)0x8000) != 0;
    player = *(BYTE **)(controller + ROTK_CONTROLLER_PLAYER_OFFSET);
    timer_positive =
        player != NULL &&
        *(const int32_t *)(player + ROTK_PLAYER_ACTION_TIMER_OFFSET) > 0;
    state = (uint8_t)InterlockedCompareExchange(&g_sprint_state, 0, 0);
    result = shotgun_sprint_step(state, shift_down, timer_positive);
    InterlockedExchange(&g_sprint_state, (LONG)result.next_state);
    if (result.rearm_controller != 0U) {
        controller[ROTK_CONTROLLER_SPRINT_OFFSET] |= 0x80U;
    }
    return (DWORD)result.sprint_requested;
}

typedef struct code_builder {
    BYTE bytes[ROTK_STUB_CAPACITY];
    SIZE_T length;
} code_builder;

static BOOL emit_bytes(
    code_builder *builder,
    const BYTE *bytes,
    SIZE_T count) {
    if (count > ROTK_STUB_CAPACITY - builder->length) {
        return FALSE;
    }
    CopyMemory(builder->bytes + builder->length, bytes, count);
    builder->length += count;
    return TRUE;
}

static BOOL emit_u64(code_builder *builder, uint64_t value) {
    return emit_bytes(builder, (const BYTE *)&value, sizeof(value));
}

static BOOL build_trampoline(
    code_builder *builder,
    const void *helper,
    const void *return_address) {
    static const BYTE prologue[] = {
        0x9C,
        0x50, 0x51, 0x52,
        0x41, 0x50, 0x41, 0x51, 0x41, 0x52, 0x41, 0x53,
        0x48, 0x81, 0xEC, 0x80, 0x00, 0x00, 0x00,
        0xF3, 0x0F, 0x7F, 0x44, 0x24, 0x20,
        0xF3, 0x0F, 0x7F, 0x4C, 0x24, 0x30,
        0xF3, 0x0F, 0x7F, 0x54, 0x24, 0x40,
        0xF3, 0x0F, 0x7F, 0x5C, 0x24, 0x50,
        0xF3, 0x0F, 0x7F, 0x64, 0x24, 0x60,
        0xF3, 0x0F, 0x7F, 0x6C, 0x24, 0x70,
        0x48, 0x89, 0xF1,
        0x48, 0xB8,
    };
    static const BYTE call_and_epilogue[] = {
        0xFF, 0xD0,
        0x89, 0xC3,
        0xF3, 0x0F, 0x6F, 0x44, 0x24, 0x20,
        0xF3, 0x0F, 0x6F, 0x4C, 0x24, 0x30,
        0xF3, 0x0F, 0x6F, 0x54, 0x24, 0x40,
        0xF3, 0x0F, 0x6F, 0x5C, 0x24, 0x50,
        0xF3, 0x0F, 0x6F, 0x64, 0x24, 0x60,
        0xF3, 0x0F, 0x6F, 0x6C, 0x24, 0x70,
        0x48, 0x81, 0xC4, 0x80, 0x00, 0x00, 0x00,
        0x41, 0x5B, 0x41, 0x5A, 0x41, 0x59, 0x41, 0x58,
        0x5A, 0x59, 0x58,
        0x9D,
        0xFF, 0x25, 0x00, 0x00, 0x00, 0x00,
    };

    ZeroMemory(builder, sizeof(*builder));
    return emit_bytes(builder, prologue, sizeof(prologue)) &&
        emit_u64(builder, (uint64_t)(uintptr_t)helper) &&
        emit_bytes(
            builder,
            call_and_epilogue,
            sizeof(call_and_epilogue)) &&
        emit_u64(builder, (uint64_t)(uintptr_t)return_address);
}

static void *try_near_address(
    uintptr_t candidate,
    SIZE_T size,
    const BYTE *hook) {
    void *allocation;
    int64_t delta;

    allocation = VirtualAlloc(
        (void *)candidate,
        size,
        MEM_RESERVE | MEM_COMMIT,
        PAGE_READWRITE);
    if (allocation == NULL) {
        return NULL;
    }
    delta =
        (int64_t)(uintptr_t)allocation -
        ((int64_t)(uintptr_t)hook + 5);
    if (delta < INT32_MIN || delta > INT32_MAX) {
        VirtualFree(allocation, 0, MEM_RELEASE);
        return NULL;
    }
    return allocation;
}

static void *allocate_trampoline_near(
    BYTE *image_base,
    SIZE_T image_size,
    const BYTE *hook,
    SIZE_T size) {
    SYSTEM_INFO information;
    uintptr_t granularity;
    uintptr_t below;
    uintptr_t above;
    uintptr_t distance;
    void *allocation;

    GetSystemInfo(&information);
    granularity = (uintptr_t)information.dwAllocationGranularity;
    below = (uintptr_t)image_base;
    above =
        ((uintptr_t)image_base + image_size + granularity - 1U) &
        ~(granularity - 1U);

    for (distance = granularity;
         distance <= UINT32_C(0x70000000);
         distance += granularity) {
        if (below > distance) {
            allocation =
                try_near_address(below - distance, size, hook);
            if (allocation != NULL) {
                return allocation;
            }
        }
        if (above <= UINTPTR_MAX - distance) {
            allocation =
                try_near_address(above + distance - granularity, size, hook);
            if (allocation != NULL) {
                return allocation;
            }
        }
    }
    return NULL;
}

static BOOL install_patch(BYTE *image_base) {
    BYTE *anti_signature =
        image_base + ROTK_ANTI_SLOW_SIGNATURE_RVA;
    BYTE *anti_patch =
        anti_signature + ROTK_ANTI_SLOW_PATCH_OFFSET;
    BYTE *resume_hook = image_base + ROTK_RESUME_HOOK_RVA;
    BYTE *resume_return = image_base + ROTK_RESUME_RETURN_RVA;
    BYTE *legacy_canary = image_base + ROTK_LEGACY_CANARY_RVA;
    static const BYTE canary_original = 0x07;
    code_builder trampoline;
    BYTE hook_patch[sizeof(k_resume_original)];
    void *remote_code;
    int64_t relative_jump;
    int32_t relative_jump32;
    DWORD old_code_protection;
    DWORD current_protection;
    DWORD old_anti_protection;
    DWORD old_hook_protection;
    BOOL anti_unprotected = FALSE;
    BOOL hook_unprotected = FALSE;
    BOOL hook_references_remote = FALSE;
    BOOL installed = FALSE;

    if (!exact_bytes(
            anti_signature,
            k_anti_slow_signature,
            sizeof(k_anti_slow_signature)) ||
        !exact_bytes(
            resume_hook,
            k_resume_signature,
            sizeof(k_resume_signature)) ||
        !exact_bytes(legacy_canary, &canary_original, 1U) ||
        !build_trampoline(
            &trampoline,
            (const void *)shotgun_sprint_hook_step,
            resume_return)) {
        return FALSE;
    }

    remote_code = allocate_trampoline_near(
        image_base,
        ROTK_H1Z1_IMAGE_SIZE,
        resume_hook,
        trampoline.length);
    if (remote_code == NULL) {
        return FALSE;
    }
    CopyMemory(remote_code, trampoline.bytes, trampoline.length);
    if (!VirtualProtect(
            remote_code,
            trampoline.length,
            PAGE_EXECUTE_READ,
            &old_code_protection)) {
        VirtualFree(remote_code, 0, MEM_RELEASE);
        return FALSE;
    }
    if (!FlushInstructionCache(
            GetCurrentProcess(),
            remote_code,
            trampoline.length)) {
        VirtualFree(remote_code, 0, MEM_RELEASE);
        return FALSE;
    }

    relative_jump =
        (int64_t)(uintptr_t)remote_code -
        ((int64_t)(uintptr_t)resume_hook + 5);
    if (relative_jump < INT32_MIN || relative_jump > INT32_MAX) {
        VirtualFree(remote_code, 0, MEM_RELEASE);
        return FALSE;
    }
    relative_jump32 = (int32_t)relative_jump;
    hook_patch[0] = 0xE9;
    CopyMemory(hook_patch + 1, &relative_jump32, sizeof(relative_jump32));
    hook_patch[5] = 0x90;
    hook_patch[6] = 0x90;

    if (!VirtualProtect(
            anti_patch,
            1U,
            PAGE_EXECUTE_READWRITE,
            &old_anti_protection)) {
        goto cleanup;
    }
    anti_unprotected = TRUE;
    if (!VirtualProtect(
            resume_hook,
            sizeof(hook_patch),
            PAGE_EXECUTE_READWRITE,
            &old_hook_protection)) {
        goto cleanup;
    }
    hook_unprotected = TRUE;

    /*
     * Allocation and permission changes may take time. Revalidate all guarded
     * bytes immediately before the first write, while both target pages are
     * already writable, so this remains one coherent transaction.
     */
    if (!exact_bytes(
            anti_signature,
            k_anti_slow_signature,
            sizeof(k_anti_slow_signature)) ||
        !exact_bytes(
            resume_hook,
            k_resume_signature,
            sizeof(k_resume_signature)) ||
        !exact_bytes(legacy_canary, &canary_original, 1U)) {
        goto cleanup;
    }

    *anti_patch = 0x82;
    CopyMemory(resume_hook, hook_patch, sizeof(hook_patch));
    hook_references_remote = TRUE;
    if (!FlushInstructionCache(GetCurrentProcess(), anti_patch, 1U) ||
        !FlushInstructionCache(
            GetCurrentProcess(),
            resume_hook,
            sizeof(hook_patch)) ||
        *anti_patch != 0x82 ||
        memcmp(resume_hook, hook_patch, sizeof(hook_patch)) != 0 ||
        *legacy_canary != 0x07) {
        goto rollback;
    }

    if (!restore_page_protection(
            resume_hook,
            sizeof(hook_patch),
            old_hook_protection)) {
        goto rollback;
    }
    hook_unprotected = FALSE;
    if (!restore_page_protection(
            anti_patch,
            1U,
            old_anti_protection)) {
        goto rollback;
    }
    anti_unprotected = FALSE;
    installed = TRUE;
    goto cleanup;

rollback:
    /*
     * If a protection restore failed after the writes, reopen any page that
     * was already sealed before rolling both edits back. The trampoline stays
     * allocated whenever the hook could still reference it.
     */
    if (!hook_unprotected &&
        VirtualProtect(
            resume_hook,
            sizeof(hook_patch),
            PAGE_EXECUTE_READWRITE,
            &current_protection)) {
        hook_unprotected = TRUE;
    }
    if (!anti_unprotected &&
        VirtualProtect(
            anti_patch,
            1U,
            PAGE_EXECUTE_READWRITE,
            &current_protection)) {
        anti_unprotected = TRUE;
    }
    if (hook_unprotected) {
        CopyMemory(
            resume_hook,
            k_resume_original,
            sizeof(k_resume_original));
        if (FlushInstructionCache(
                GetCurrentProcess(),
                resume_hook,
                sizeof(k_resume_original))) {
            hook_references_remote = FALSE;
        }
    }
    if (anti_unprotected) {
        *anti_patch = 0x8F;
        FlushInstructionCache(GetCurrentProcess(), anti_patch, 1U);
    }

cleanup:
    if (hook_unprotected &&
        !restore_page_protection(
            resume_hook,
            sizeof(hook_patch),
            old_hook_protection)) {
        debug_status("ROTK gameplay patch: hook protection restore failed.\n");
    }
    if (anti_unprotected &&
        !restore_page_protection(
            anti_patch,
            1U,
            old_anti_protection)) {
        debug_status("ROTK gameplay patch: anti-slow protection restore failed.\n");
    }
    if (!installed && !hook_references_remote) {
        VirtualFree(remote_code, 0, MEM_RELEASE);
    }
    return installed;
}

static DWORD WINAPI patch_worker(LPVOID parameter) {
    HMODULE executable = GetModuleHandleW(NULL);
    BYTE *image_base = NULL;
    DWORD iteration;

    (void)parameter;
    if (!validate_h1z1_image(executable, &image_base)) {
        debug_status("ROTK gameplay patch: unsupported executable; skipped.\n");
        return 0U;
    }

    for (iteration = 0U;
         iteration < ROTK_PATCH_WAIT_ITERATIONS;
         ++iteration) {
        if (install_patch(image_base)) {
            debug_status("ROTK gameplay patch: shotgun sprint patch installed.\n");
            return 0U;
        }
        Sleep(ROTK_PATCH_WAIT_MS);
    }
    debug_status("ROTK gameplay patch: signatures unavailable; skipped.\n");
    return 0U;
}

static void start_patch_worker(void) {
    HANDLE worker;

    if (InterlockedCompareExchange(
            &g_patch_worker_started,
            1,
            0) != 0) {
        return;
    }
    worker = CreateThread(NULL, 0U, patch_worker, NULL, 0U, NULL);
    if (worker == NULL) {
        InterlockedExchange(&g_patch_worker_started, 0);
        return;
    }
    CloseHandle(worker);
}

HRESULT WINAPI DirectInput8Create(
    HINSTANCE instance,
    DWORD version,
    REFIID interface_id,
    LPVOID *output,
    void *outer) {
    InitOnceExecuteOnce(
        &g_system_dinput_once,
        load_system_dinput,
        NULL,
        NULL);
    if (g_direct_input8_create == NULL) {
        return E_FAIL;
    }
    start_patch_worker();
    return g_direct_input8_create(
        instance,
        version,
        interface_id,
        output,
        outer);
}

HRESULT WINAPI DllCanUnloadNow(void) {
    InitOnceExecuteOnce(
        &g_system_dinput_once,
        load_system_dinput,
        NULL,
        NULL);
    return g_dll_can_unload_now == NULL ? E_FAIL : g_dll_can_unload_now();
}

HRESULT WINAPI DllGetClassObject(
    const void *class_id,
    const void *interface_id,
    LPVOID *output) {
    InitOnceExecuteOnce(
        &g_system_dinput_once,
        load_system_dinput,
        NULL,
        NULL);
    return g_dll_get_class_object == NULL
        ? E_FAIL
        : g_dll_get_class_object(class_id, interface_id, output);
}

HRESULT WINAPI DllRegisterServer(void) {
    InitOnceExecuteOnce(
        &g_system_dinput_once,
        load_system_dinput,
        NULL,
        NULL);
    return g_dll_register_server == NULL ? E_FAIL : g_dll_register_server();
}

HRESULT WINAPI DllUnregisterServer(void) {
    InitOnceExecuteOnce(
        &g_system_dinput_once,
        load_system_dinput,
        NULL,
        NULL);
    return g_dll_unregister_server == NULL
        ? E_FAIL
        : g_dll_unregister_server();
}

const void *WINAPI GetdfDIJoystick(void) {
    InitOnceExecuteOnce(
        &g_system_dinput_once,
        load_system_dinput,
        NULL,
        NULL);
    return g_get_joystick_format == NULL ? NULL : g_get_joystick_format();
}

BOOL WINAPI DllMain(
    HINSTANCE instance,
    DWORD reason,
    LPVOID reserved) {
    (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {
        DisableThreadLibraryCalls(instance);
    }
    return TRUE;
}
