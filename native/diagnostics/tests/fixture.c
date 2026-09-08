#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <string.h>

static volatile unsigned long sink;

static LONG CALLBACK handled_exception(EXCEPTION_POINTERS *pointers) {
    if (pointers->ExceptionRecord->ExceptionCode == 0xE0424242) {
        ++sink;
        return EXCEPTION_CONTINUE_EXECUTION;
    }
    return EXCEPTION_CONTINUE_SEARCH;
}

__declspec(noinline) static void exhaust_stack(unsigned depth) {
    volatile unsigned char page[4096];
    page[depth % sizeof(page)] = (unsigned char)depth;
    void (*volatile recurse)(unsigned) = exhaust_stack;
    recurse(depth + 1);
    sink += page[depth % sizeof(page)];
}

int main(void) {
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    AddVectoredExceptionHandler(1, handled_exception);
    ULONG guarantee = 65536;
    SetThreadStackGuarantee(&guarantee);
    puts("ready"); fflush(stdout);
    char command[64];
    while (fgets(command, sizeof(command), stdin)) {
        if (strncmp(command, "av", 2) == 0) {
            volatile ULONG_PTR bad_address = 1;
            *(volatile unsigned *)bad_address = 0xDEAD;
        } else if (strncmp(command, "stack", 5) == 0) {
            exhaust_stack(0);
        } else if (strncmp(command, "handled", 7) == 0) {
            for (unsigned i = 0; i < 100; ++i) RaiseException(0xE0424242, 0, 0, NULL);
            printf("handled:%lu\n", sink); fflush(stdout);
        } else if (strncmp(command, "ping", 4) == 0) {
            printf("alive:debugger=%d\n", IsDebuggerPresent()); fflush(stdout);
        } else if (strncmp(command, "exit", 4) == 0) return 0;
    }
    return 0;
}
