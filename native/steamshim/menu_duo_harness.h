/* Opt-in LOCAL HARNESS transport. The server owns this file, not the UI.
 * This is not a production network/party authority. No process-memory hooks.
 * Lines: Steam member id, observer-local display actor id, display name.
 * Missing, invalid or >6s-old files remove the member. */
static uint64_t g_menu_duo_member = 0;
static char g_menu_duo_actor[32] = "";
static char g_menu_duo_name[128] = "";
static uint64_t g_menu_duo_callback_member = 0;
static uint32_t g_menu_duo_callback_change = 0;

static const char *menu_duo_member_value(const char *key) {
    if (!_stricmp(key, "daybreakCharId") || !_stricmp(key, "h1z1_character")) return g_menu_duo_actor;
    if (!_stricmp(key, "daybreakUserId")) return "0";
    if (!_stricmp(key, "datacenter")) return "AMS";
    if (!_stricmp(key, "SelectedMatchCanEnter")) return "-1";
    if (!_stricmp(key, "status")) return "Z1BR  - Main Menu";
    if (!_stricmp(key, "ready") || !_stricmp(key, "inGame") ||
        !_stricmp(key, "ViewingHostedGames") || !_stricmp(key, "SelectedMatchRole") ||
        !_stricmp(key, "SelectedMatchId") || !_stricmp(key, "matchId")) return "0";
    return "";
}

static void poll_menu_duo_harness(void) {
    static ULONGLONG last_poll = 0;
    ULONGLONG tick = GetTickCount64();
    char path[MAX_PATH], content[256] = {0}, actor[32] = {0}, name[128] = {0};
    unsigned long long member = 0, actor_id = 0;
    DWORD length = GetEnvironmentVariableA("ROTK_MENU_DUO_HARNESS_FILE", path, sizeof(path));
    if (!length || length >= sizeof(path) || tick - last_poll < 500) return;
    last_poll = tick;
    HANDLE file = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file != INVALID_HANDLE_VALUE) {
        FILETIME modified, now;
        ULARGE_INTEGER stamp, clock;
        DWORD bytes = 0;
        GetSystemTimeAsFileTime(&now);
        clock.LowPart = now.dwLowDateTime; clock.HighPart = now.dwHighDateTime;
        if (GetFileTime(file, NULL, NULL, &modified)) {
            stamp.LowPart = modified.dwLowDateTime; stamp.HighPart = modified.dwHighDateTime;
            if (clock.QuadPart >= stamp.QuadPart && clock.QuadPart - stamp.QuadPart <= 60000000ULL &&
                ReadFile(file, content, sizeof(content) - 1, &bytes, NULL) && bytes < sizeof(content) - 1 &&
                sscanf(content, "%llu\n%llu\n%127[^\r\n]", &member, &actor_id, name) == 3 &&
                member >= 76561197960265728ULL && member != g_fake_steam_id &&
                (actor_id >> 48) == 0x6000) {
                snprintf(actor, sizeof(actor), "%llu", actor_id);
            } else member = 0;
        }
        CloseHandle(file);
    }
    if (!member) { actor[0] = 0; name[0] = 0; }
    uint64_t previous = g_menu_duo_member;
    int changed = previous != member || strcmp(g_menu_duo_actor, actor) || strcmp(g_menu_duo_name, name);
    if (!changed) return;
    g_menu_duo_member = member;
    lstrcpynA(g_menu_duo_actor, actor, sizeof(g_menu_duo_actor));
    lstrcpynA(g_menu_duo_name, name, sizeof(g_menu_duo_name));
    if (previous && previous != member) {
        g_menu_duo_callback_member = previous;
        g_menu_duo_callback_change = 2; /* Left */
        dispatch_callbacks_by_id(506, "MenuDuoHarness leave", 1);
    }
    if (member) {
        g_menu_duo_callback_member = member;
        if (previous != member) {
            g_menu_duo_callback_change = 1; /* Entered */
            dispatch_callbacks_by_id(506, "MenuDuoHarness join", 1);
        }
        dispatch_callbacks_by_id(505, "MenuDuoHarness member data", 1);
    }
    g_menu_duo_callback_member = 0;
    g_menu_duo_callback_change = 0;
    log_line("MenuDuoHarness native roster member=%llu actor=%s name=%s",
        member, actor, name);
}
