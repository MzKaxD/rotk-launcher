/* Zig -O2 defines NDEBUG. These are executable checks, never release no-ops. */
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include "../steam_api64.c"
static unsigned joined, left, updated;
typedef struct TestCallback { void **vtable; int id; } TestCallback;
static void callback_run(void *self, void *payload) {
    TestCallback *callback = self;
    const unsigned char *bytes = payload;
    uint64_t member; memcpy(&member, bytes + 8, 8);
    assert(member == 76561198000005002ULL);
    if (callback->id == 505) updated++;
    else { uint32_t change; memcpy(&change, bytes + 24, 4);
        if (change == 1) joined++; else { assert(change == 2); left++; }
    }
}
static int callback_size(void *self) { return ((TestCallback *)self)->id == 505 ? 24 : 32; }
static int receive(const char *message, ULONGLONG now) { return receive_menu_duo_native(message, strlen(message) + 1, now); }
int main(int argc, char **argv) {
    void *vtable[] = {(void *)callback_run, NULL, (void *)callback_size};
    TestCallback data = {vtable, 505}, chat = {vtable, 506};
    g_fake_steam_id = 76561198000005001ULL;
    SteamAPI_RegisterCallback(&data, 505); SteamAPI_RegisterCallback(&chat, 506);
    DummyObject mm = {NULL, "SteamMatchMaking009"};
    if (argc == 2 && !strcmp(argv[1], "--wire")) {
        char frame[1024]; unsigned frames = 0;
        while (fgets(frame, sizeof(frame), stdin)) {
            frame[strcspn(frame, "\r\n")] = 0;
            assert(generic_interface_method(&mm,26,0,(uintptr_t)frame,strlen(frame)+1,0) == 1);
            poll_menu_duo_native(GetTickCount64());
            frames++;
            assert(generic_interface_method(&mm,17,0,0,0,0) == (frames == 3 ? 1 : 2));
            printf("wire member=%llu actor=%s name=%s\n", (unsigned long long)g_menu_duo_member, g_menu_duo_actor, g_menu_duo_name);
        }
        assert(frames == 4 && joined == 2 && left == 1 && updated == 3);
        assert(g_menu_duo_sequence > 0xffffffffULL);
        puts("PASS actual server frames: large sequence, appearance replacement, leave and rejoin.");
        return 0;
    }
    assert(generic_interface_method(&mm,17,0,0,0,0) == 1);
    const char *first = "@CHAT:ROTK_MENU_DUO_V1|1|76561198000005002|6917529027641156017|Ren%C3%A9%20%7C%20Mate";
    assert(generic_interface_method(&mm,26,0,(uintptr_t)first,strlen(first)+1,0) == 1);
    assert(g_menu_duo_member == 0); /* no callbacks inside the UI stack */
    poll_menu_duo_native(GetTickCount64());
    assert(generic_interface_method(&mm,17,0,0,0,0) == 2);
    assert(generic_interface_method(&mm,18,0,1,0,0) == 76561198000005002ULL);
    assert(!strcmp(g_menu_duo_actor,"6917529027641156017"));
    assert(!strcmp(g_menu_duo_name,"Ren\xc3\xa9 | Mate"));
    assert(joined == 1 && updated == 1 && left == 0);
    const char *key = "daybreakCharId";
    assert(!strcmp((char *)generic_interface_method(&mm,24,1,76561198000005002ULL,(uintptr_t)key,0),g_menu_duo_actor));
    assert(!strcmp((char *)generic_interface_method(&mm,24,1,76561198000009999ULL,(uintptr_t)key,0),""));
    assert(!receive(first,1000)); /* stale sequence cannot renew */
    const char *invalid[] = {
        "@CHAT:ROTK_MENU_DUO_V1|2|76561198000005001|6917529027641156017|Self",
        "@CHAT:ROTK_MENU_DUO_V1|2|76561198000005002|123|BadActor",
        "@CHAT:ROTK_MENU_DUO_V1|2|18446744073709551616|6917529027641156017|Overflow",
        "@CHAT:ROTK_MENU_DUO_V1|02|76561198000005002|6917529027641156017|Noncanonical",
        "@CHAT:ROTK_MENU_DUO_V1|2|76561198000005002|6917529027641156017|%00Hidden",
        "@CHAT:ROTK_MENU_DUO_V1|2|76561198000005002|6917529027641156017|Bad%GG",
        "@CHAT:ROTK_MENU_DUO_V1|2|0|0|UnexpectedName",
        "@CHAT:ROTK_MENU_DUO_V1|9007199254740992|0|0|",
        "@CHAT:ROTK_MENU_DUO_V1|2|0|0||",
        "@CHAT:normal lobby chat"
    };
    for (unsigned i=0;i<sizeof(invalid)/sizeof(invalid[0]);i++) assert(!receive(invalid[i],1000));
    assert(g_menu_duo_sequence == 1 && g_menu_duo_member == 76561198000005002ULL);
    assert(receive("@CHAT:ROTK_MENU_DUO_V1|2|76561198000005002|6917529027641221553|Changed",1000));
    poll_menu_duo_native(1001);
    assert(updated == 2 && joined == 1 && left == 0);
    assert(!strcmp(g_menu_duo_actor,"6917529027641221553"));
    poll_menu_duo_native(21000);
    assert(generic_interface_method(&mm,17,0,0,0,0) == 1 && left == 1);
    assert(!receive(first,22000));
    assert(receive("@CHAT:ROTK_MENU_DUO_V1|3|76561198000005002|6917529027641287089|Return",22000));
    poll_menu_duo_native(22001); assert(joined == 2);
    assert(receive("@CHAT:ROTK_MENU_DUO_CLEAR_V1",22002));
    poll_menu_duo_native(22003); assert(left == 2 && g_menu_duo_member == 0);
    assert(!receive_menu_duo_native((const char *)1,100,22004));
    puts("PASS native menu: real matchmaking entry points, exact IDs, UTF-8 name, deferred callbacks, generations, leave/rejoin, expiry, malformed/stale/self/unknown input.");
    return 0;
}
