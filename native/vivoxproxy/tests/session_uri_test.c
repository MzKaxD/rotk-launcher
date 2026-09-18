/* Exercise the shipped C implementation, including its native join layout. */
#define ROTK_VIVOX_V5_COMPAT 1
#include "../vivoxsdk_x64_proxy.c"
#ifdef NDEBUG
#undef NDEBUG
#endif
#include <assert.h>
#include <stdlib.h>

static unsigned allocations, releases;
static BOOL fail_allocation;

static char *duplicate_test(const char *value) {
    if (fail_allocation) return NULL;
    size_t bytes = strlen(value) + 1U;
    char *copy = malloc(bytes);
    assert(copy != NULL);
    memcpy(copy, value, bytes);
    ++allocations;
    return copy;
}

static int release_test(char *value) {
    if (value != NULL) { ++releases; free(value); }
    return 0;
}

static char *join_room(const char *room) {
    uint8_t request[SESSIONGROUP_REQUEST_BYTES] = {0};
    voice_grant grant = {0};
    strcpy(grant.channel, room);
    assert(mutate_sessiongroup_context(request, &grant));
    char *account = NULL, *session = NULL;
    read_pointer(request, SESSIONGROUP_ACCOUNT_OFFSET, &account);
    read_pointer(request, SESSIONGROUP_SESSION_HANDLE_OFFSET, &session);
    assert(strcmp(session, room) == 0);
    release_test(account);
    return session;
}

static rotk_vx_evt_session_added session_event(char *handle) {
    rotk_vx_evt_session_added event = {0};
    event.base.message.type = VIVOX_MESSAGE_EVENT;
    event.base.type = VIVOX_EVENT_SESSION_ADDED;
    event.session_handle = handle;
    return event;
}

static void deliver(char *handle) {
    rotk_vx_evt_session_added event = session_event(handle);
    compat_restore_session_added_uri(&event);
    assert(event.uri != NULL);
    if (strcmp(event.uri, handle) != 0) {
        fputs("FAIL: session-added event was assigned another room\n", stderr);
        abort();
    }
    assert(event.uri != handle); /* The SDK must own two separate strings. */
    assert(event.session_handle == handle);
    char *restored = event.uri;
    compat_restore_session_added_uri(&event);
    assert(event.uri == restored); /* Reprocessing must neither leak nor reassign. */
    release_test(event.uri);
}

static void invalid_handle(char *handle) {
    rotk_vx_evt_session_added event = session_event(handle);
    compat_restore_session_added_uri(&event);
    assert(event.uri == NULL);
    assert(event.session_handle == handle);
}

int main(void) {
    const char *rooms[] = {
        "sip:confctl-d-90724-rotk-78630.123@mtu1xp.vivox.com",
        "sip:confctl-g-90724-rotk-78630.g-0000000000001@mtu1xp.vivox.com",
        "sip:confctl-d-90724-rotk-78630.456@mtu1xp.vivox.com",
        "sip:confctl-g-90724-rotk-78630.g-0000000000002@mtu1xp.vivox.com"
    };
    char *handles[4];
    g_strdup = duplicate_test;
    g_free = release_test;
    strcpy(g_account_handle, "fixture-account");

    /* Solo and serialized Duo remain valid. */
    for (unsigned i = 0; i < 2; ++i) {
        char *handle = join_room(rooms[i]);
        deliver(handle);
        release_test(handle);
    }

    /* Two outstanding joins: both response orders must preserve both rooms. */
    for (unsigned reverse = 0; reverse < 2; ++reverse) {
        handles[0] = join_room(rooms[0]);
        handles[1] = join_room(rooms[1]);
        deliver(handles[reverse]);
        deliver(handles[1 - reverse]);
        release_test(handles[0]);
        release_test(handles[1]);
    }

    /* Lobby/match handoff or a new Duo: every old/new event permutation. */
    for (unsigned i = 0; i < 4; ++i) handles[i] = join_room(rooms[i]);
    SecureZeroMemory(g_account_handle, sizeof(g_account_handle)); /* logout */
    unsigned permutations = 0;
    for (unsigned a = 0; a < 4; ++a)
        for (unsigned b = 0; b < 4; ++b)
            for (unsigned c = 0; c < 4; ++c)
                for (unsigned d = 0; d < 4; ++d) {
                    if (a == b || a == c || a == d || b == c || b == d || c == d) continue;
                    deliver(handles[a]); deliver(handles[b]);
                    deliver(handles[c]); deliver(handles[d]);
                    ++permutations;
                }
    assert(permutations == 24);

    rotk_vx_evt_session_added event = session_event(handles[0]);
    event.uri = duplicate_test(rooms[2]); /* Already supplied by the SDK: preserve it. */
    char *original = event.uri;
    compat_restore_session_added_uri(&event);
    assert(event.uri == original && strcmp(event.uri, rooms[2]) == 0);
    release_test(event.uri);

    event = session_event(handles[0]);
    event.uri = duplicate_test(""); /* A separately allocated empty SDK field. */
    original = event.uri;
    fail_allocation = TRUE;
    compat_restore_session_added_uri(&event);
    assert(event.uri == original && event.uri[0] == '\0');
    fail_allocation = FALSE;
    compat_restore_session_added_uri(&event);
    assert(event.uri != NULL && strcmp(event.uri, rooms[0]) == 0);
    release_test(event.uri);

    invalid_handle(NULL);
    invalid_handle("");
    invalid_handle("unrelated-session-handle");
    invalid_handle("sip:confctl-x-unexpected@domain");
    invalid_handle("sip:confctl-g-");
    invalid_handle("sip:confctl-g-test\r\nInjected:yes");
    invalid_handle("sip:confctl-g-test.\x80@domain");
    char oversized[65];
    memset(oversized, 'x', 64); oversized[64] = '\0';
    memcpy(oversized, "sip:confctl-g-", 14);
    invalid_handle(oversized);
    void *unreadable = VirtualAlloc(NULL, 4096, MEM_COMMIT | MEM_RESERVE, PAGE_NOACCESS);
    assert(unreadable != NULL);
    invalid_handle(unreadable);
    event = session_event(handles[0]);
    event.uri = unreadable;
    compat_restore_session_added_uri(&event);
    assert(event.uri == unreadable);
    assert(VirtualFree(unreadable, 0, MEM_RELEASE));

    event = session_event(handles[0]);
    event.base.type = VIVOX_EVENT_SESSIONGROUP_ADDED;
    compat_restore_session_added_uri(&event);
    assert(event.uri == NULL);
    event.base.type = VIVOX_EVENT_SESSION_ADDED;
    event.base.message.type = VIVOX_MESSAGE_RESPONSE;
    compat_restore_session_added_uri(&event);
    assert(event.uri == NULL);
    compat_restore_session_added_uri(NULL);

    for (unsigned i = 0; i < 4; ++i) release_test(handles[i]);
    assert(allocations == releases);
    puts("PASS: Solo, both Duo event orders, all 24 handoff orders, logout, malformed handles and SDK string ownership.");
    return 0;
}
