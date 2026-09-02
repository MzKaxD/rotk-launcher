#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>

typedef HRESULT(WINAPI *direct_input8_create_fn)(
    HINSTANCE,
    DWORD,
    const GUID *,
    void **,
    void *);
typedef HRESULT(WINAPI *hresult_no_args_fn)(void);
typedef const void *(WINAPI *get_joystick_format_fn)(void);
typedef ULONG(WINAPI *release_fn)(void *);

static const GUID k_iid_direct_input8_w = {
    0xBF798031,
    0x483A,
    0x4DA2,
    {0xAA, 0x99, 0x5D, 0x64, 0xED, 0x36, 0x97, 0x00},
};

static FARPROC require_export(HMODULE module, const char *name) {
    FARPROC address = GetProcAddress(module, name);
    if (address == NULL) {
        fprintf(stderr, "missing export: %s\n", name);
        ExitProcess(2U);
    }
    return address;
}

int main(int argc, char **argv) {
    HMODULE proxy;
    FARPROC direct_address;
    FARPROC can_unload_address;
    FARPROC joystick_address;
    direct_input8_create_fn direct_input8_create;
    hresult_no_args_fn can_unload;
    get_joystick_format_fn get_joystick_format;
    void *direct_input = NULL;
    HRESULT result;
    union {
        FARPROC source;
        direct_input8_create_fn destination;
    } direct_cast;
    union {
        FARPROC source;
        hresult_no_args_fn destination;
    } unload_cast;
    union {
        FARPROC source;
        get_joystick_format_fn destination;
    } joystick_cast;

    if (argc != 2) {
        fputs("usage: dinput8_proxy_smoke.exe <absolute-dinput8.dll>\n", stderr);
        return 2;
    }
    proxy = LoadLibraryA(argv[1]);
    if (proxy == NULL) {
        fprintf(stderr, "LoadLibrary failed: %lu\n", GetLastError());
        return 2;
    }

    direct_address = require_export(proxy, "DirectInput8Create");
    can_unload_address = require_export(proxy, "DllCanUnloadNow");
    require_export(proxy, "DllGetClassObject");
    require_export(proxy, "DllRegisterServer");
    require_export(proxy, "DllUnregisterServer");
    joystick_address = require_export(proxy, "GetdfDIJoystick");

    direct_cast.source = direct_address;
    direct_input8_create = direct_cast.destination;
    unload_cast.source = can_unload_address;
    can_unload = unload_cast.destination;
    joystick_cast.source = joystick_address;
    get_joystick_format = joystick_cast.destination;

    if (get_joystick_format() == NULL) {
        fputs("GetdfDIJoystick did not forward to the system DLL\n", stderr);
        return 3;
    }
    result = can_unload();
    if (result != S_OK && result != S_FALSE) {
        fprintf(stderr, "DllCanUnloadNow forwarding failed: 0x%08lx\n", (unsigned long)result);
        return 3;
    }
    result = direct_input8_create(
        GetModuleHandleW(NULL),
        0x0800U,
        &k_iid_direct_input8_w,
        &direct_input,
        NULL);
    if (FAILED(result) || direct_input == NULL) {
        fprintf(stderr, "DirectInput8Create forwarding failed: 0x%08lx\n", (unsigned long)result);
        return 4;
    }
    {
        void **vtable = *(void ***)direct_input;
        union {
            void *source;
            release_fn destination;
        } release_cast;
        release_cast.source = vtable[2];
        release_cast.destination(direct_input);
    }

    /* Let the guarded worker reject this non-H1Z1 host before unloading. */
    Sleep(100U);
    FreeLibrary(proxy);
    puts("dinput8 proxy smoke test passed");
    return 0;
}
