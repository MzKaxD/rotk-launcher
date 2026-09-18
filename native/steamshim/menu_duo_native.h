/* Server -> owner-only broadcast -> GFX -> SteamSendChatToLobby -> shim.
 * Presentation only: never changes the authoritative ROTK party or inventory.
 * Steam callbacks run on the existing callback pump, outside the UI call. */
static uint64_t g_menu_duo_member = 0, g_menu_duo_sequence = 0;
static char g_menu_duo_actor[32] = "", g_menu_duo_name[129] = "";
static uint64_t g_menu_duo_callback_member = 0;
static uint32_t g_menu_duo_callback_change = 0;
static uint64_t g_menu_duo_pending_member = 0;
static char g_menu_duo_pending_actor[32] = "", g_menu_duo_pending_name[129] = "";
static ULONGLONG g_menu_duo_expires = 0;
static int g_menu_duo_pending = 0;

static int menu_duo_u64(const char *text, uint64_t *out) {
    uint64_t value = 0;
    if (!*text || (*text == '0' && text[1])) return 0;
    for (; *text; ++text) {
        if (*text < '0' || *text > '9' || value > (UINT64_MAX - (*text - '0')) / 10) return 0;
        value = value * 10 + (*text - '0');
    }
    *out = value; return 1;
}
static int menu_duo_hex(char value) {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
}
static int menu_duo_name(const char *text, char *out, size_t capacity) {
    size_t used = 0;
    while (*text) {
        unsigned char value = (unsigned char)*text++;
        if (value == '%') {
            if (!text[0] || !text[1]) return 0;
            int high = menu_duo_hex(text[0]), low = menu_duo_hex(text[1]);
            if (high < 0 || low < 0) return 0;
            value = (unsigned char)(high * 16 + low); text += 2;
        }
        if (value < 32 || value == 127 || used + 1 >= capacity) return 0;
        out[used++] = (char)value;
    }
    out[used] = 0; return used > 0;
}
static int receive_menu_duo_native(const char *message, size_t size, ULONGLONG now) {
    char buffer[1024], name[129] = "", *fields[4], *cursor;
    uint64_t sequence, member, actor;
    const char prefix[] = "@CHAT:ROTK_MENU_DUO_V1|";
    if (!size || size >= sizeof(buffer) || !can_access_process_memory((uintptr_t)message, size, 0)) return 0;
    memcpy(buffer, message, size);
    if (buffer[size - 1] == 0) --size;
    if (memchr(buffer, 0, size)) return 0;
    buffer[size] = 0;
    if (!strcmp(buffer, "@CHAT:ROTK_MENU_DUO_CLEAR_V1")) {
        g_menu_duo_pending_member = 0; g_menu_duo_pending_actor[0] = g_menu_duo_pending_name[0] = 0;
        g_menu_duo_expires = 0; g_menu_duo_pending = 1; return 1;
    }
    if (strncmp(buffer, prefix, sizeof(prefix) - 1)) return 0;
    cursor = buffer + sizeof(prefix) - 1;
    for (int i = 0; i < 4; ++i) {
        fields[i] = cursor;
        char *separator = strchr(cursor, '|');
        if (i == 3) { if (separator) return 0; }
        else { if (!separator) return 0; *separator = 0; cursor = separator + 1; }
    }
    if (!menu_duo_u64(fields[0], &sequence) || !sequence || sequence > 9007199254740991ULL || sequence <= g_menu_duo_sequence ||
        !menu_duo_u64(fields[1], &member) || !menu_duo_u64(fields[2], &actor)) return 0;
    if (member == 0) { if (actor || fields[3][0]) return 0; }
    else if (member < 76561197960265728ULL || member == g_fake_steam_id || (actor >> 48) != 0x6000 ||
        !menu_duo_name(fields[3], name, sizeof(name))) return 0;
    g_menu_duo_sequence = sequence;
    g_menu_duo_pending_member = member;
    if (member) snprintf(g_menu_duo_pending_actor, sizeof(g_menu_duo_pending_actor), "%llu", (unsigned long long)actor);
    else g_menu_duo_pending_actor[0] = 0;
    lstrcpynA(g_menu_duo_pending_name, name, sizeof(g_menu_duo_pending_name));
    g_menu_duo_expires = member ? now + 20000 : 0;
    g_menu_duo_pending = 1;
    return 1;
}
static const char *menu_duo_member_value(const char *key) {
    if (!_stricmp(key, "daybreakCharId") || !_stricmp(key, "h1z1_character")) return g_menu_duo_actor;
    if (!_stricmp(key, "daybreakUserId")) return "0";
    if (!_stricmp(key, "datacenter")) return g_fake_lobby_datacenter;
    if (!_stricmp(key, "SelectedMatchCanEnter")) return "-1";
    if (!_stricmp(key, "status")) return "Z1BR  - Main Menu";
    if (!_stricmp(key, "ready") || !_stricmp(key, "inGame") ||
        !_stricmp(key, "ViewingHostedGames") || !_stricmp(key, "SelectedMatchRole") ||
        !_stricmp(key, "SelectedMatchId") || !_stricmp(key, "matchId")) return "0";
    return "";
}
static void poll_menu_duo_native(ULONGLONG now) {
    if (g_menu_duo_expires && now >= g_menu_duo_expires) {
        g_menu_duo_pending_member = 0; g_menu_duo_pending_actor[0] = g_menu_duo_pending_name[0] = 0;
        g_menu_duo_expires = 0; g_menu_duo_pending = 1;
    }
    if (!g_menu_duo_pending) return;
    g_menu_duo_pending = 0;
    uint64_t previous = g_menu_duo_member;
    uint64_t member = g_menu_duo_pending_member;
    if (previous == member && !strcmp(g_menu_duo_actor, g_menu_duo_pending_actor) && !strcmp(g_menu_duo_name, g_menu_duo_pending_name)) return;
    g_menu_duo_member = member;
    lstrcpynA(g_menu_duo_actor, g_menu_duo_pending_actor, sizeof(g_menu_duo_actor));
    lstrcpynA(g_menu_duo_name, g_menu_duo_pending_name, sizeof(g_menu_duo_name));
    if (previous && previous != member) {
        g_menu_duo_callback_member = previous; g_menu_duo_callback_change = 2;
        dispatch_callbacks_by_id(506, "MenuDuo leave", 1);
    }
    if (member) {
        g_menu_duo_callback_member = member;
        if (previous != member) {
            g_menu_duo_callback_change = 1;
            dispatch_callbacks_by_id(506, "MenuDuo join", 1);
        }
        dispatch_callbacks_by_id(505, "MenuDuo member data", 1);
    }
    g_menu_duo_callback_member = 0; g_menu_duo_callback_change = 0;
    log_line("MenuDuo native roster member=%llu actor=%s", (unsigned long long)member, g_menu_duo_actor);
}
