/* Optional low-rate process counter sampler. No ETW provider, thread suspension,
 * hooks, code injection, process enumeration or privilege adjustment. */
#ifndef ROTK_DIAGNOSTICS_PERFORMANCE_H
#define ROTK_DIAGNOSTICS_PERFORMANCE_H

#ifndef PERF_LOG_LIMIT
#define PERF_LOG_LIMIT (16ULL * 1024 * 1024)
#endif
#ifndef PERF_MAX_DURATION
#define PERF_MAX_DURATION (8ULL * 60 * 60 * 1000)
#endif
#define PERF_INTERVAL 1000
#define PERF_TOP_COUNT 16

typedef struct {
    ULONGLONG elapsed, interval;
    char at[40];
    double cpu_one_core, read_rate, write_rate, faults_rate, score;
    uint64_t private_bytes, working_set;
    unsigned signals;
} PERF_PEAK;

static struct {
    BOOL enabled, running, previous_cpu, previous_memory, previous_io, threads_known;
    HANDLE process;
    DWORD pid, thread_count, previous_faults;
    uint64_t threads_created, threads_exited, previous_created, previous_exited;
    FILE *log;
    wchar_t log_path[PATH_CAP], summary_path[PATH_CAP];
    uint64_t log_bytes, rotations, sample_count, log_write_errors;
    uint64_t cpu_samples, memory_samples, io_samples, thread_samples, system_samples;
    ULONGLONG start_tick, previous_tick, next_tick, next_summary;
    LARGE_INTEGER qpc_frequency, start_qpc;
    uint64_t previous_cpu_time, previous_private, previous_working_set;
    IO_COUNTERS previous_io_values;
    uint64_t total_cpu_100ns, cpu_measured_ms, total_read, total_write, total_other, total_faults;
    uint64_t peak_private, peak_working_set, peak_thread_count, peak_handles, max_interval_ms;
    uint64_t min_system_physical, min_system_commit;
    double peak_cpu_one_core, peak_read_rate, peak_write_rate, peak_faults_rate, previous_cpu_one_core;
    uint64_t sample_cost_qpc, max_sample_cost_qpc;
    uint64_t helper_cpu_start;
    unsigned logical_processors, peak_count;
    PERF_PEAK peaks[PERF_TOP_COUNT];
    char started_at[40];
} perf;

static void perf_timestamp(char output[40]) {
    SYSTEMTIME time; GetSystemTime(&time);
    snprintf(output, 40, "%04u-%02u-%02uT%02u:%02u:%02u.%03uZ", time.wYear,
        time.wMonth, time.wDay, time.wHour, time.wMinute, time.wSecond, time.wMilliseconds);
}

static uint64_t perf_cpu_time(HANDLE process, BOOL *ok) {
    FILETIME created, exited, kernel, user;
    *ok = GetProcessTimes(process, &created, &exited, &kernel, &user);
    return *ok ? filetime_value(kernel) + filetime_value(user) : 0;
}

static void perf_write_line(const char *line, size_t length, BOOL summary) {
    fwrite(line, 1, length, stdout); fflush(stdout);
    if (perf.log) {
        if (fwrite(line, 1, length, perf.log) != length || fflush(perf.log) != 0) ++perf.log_write_errors;
        perf.log_bytes += length;
        if (perf.log_bytes >= PERF_LOG_LIMIT) {
            fclose(perf.log); perf.log = NULL;
            wchar_t previous[PATH_CAP];
            swprintf(previous, PATH_CAP, L"%ls.1", perf.log_path);
            if (MoveFileExW(perf.log_path, previous, MOVEFILE_REPLACE_EXISTING)) {
                perf.log = _wfopen(perf.log_path, L"wb"); perf.log_bytes = 0; ++perf.rotations;
            }
            if (!perf.log) ++perf.log_write_errors;
        }
    }
    if (summary) {
        wchar_t temporary[PATH_CAP];
        swprintf(temporary, PATH_CAP, L"%ls.tmp", perf.summary_path);
        FILE *file = _wfopen(temporary, L"wb");
        if (!file) { ++perf.log_write_errors; return; }
        BOOL written = fwrite(line, 1, length, file) == length;
        if (fclose(file) != 0) written = FALSE;
        if (!written || !MoveFileExW(temporary, perf.summary_path, MOVEFILE_REPLACE_EXISTING)) {
            ++perf.log_write_errors; DeleteFileW(temporary);
        }
    }
}

static void perf_emit(BOOL summary, const char *event, const char *format, ...) {
    char payload[16000], line[16500], at[40];
    va_list arguments; va_start(arguments, format);
    vsnprintf(payload, sizeof(payload), format, arguments); va_end(arguments);
    LARGE_INTEGER qpc; QueryPerformanceCounter(&qpc);
    perf_timestamp(at);
    int length = snprintf(line, sizeof(line),
        "{\"event\":\"%s\",\"schemaVersion\":1,\"at\":\"%s\",\"pid\":%lu,\"elapsedMs\":%llu,\"qpc\":\"%lld\"%s}\n",
        event, at, (unsigned long)perf.pid, GetTickCount64() - perf.start_tick, qpc.QuadPart, payload);
    if (length > 0 && (size_t)length < sizeof(line)) perf_write_line(line, (size_t)length, summary);
}

static void perf_signals(unsigned mask, char output[200]) {
    static const char *names[] = {"cpu-load-rise", "working-set-drop", "private-memory-rise", "page-fault-burst", "io-burst", "sampler-delayed"};
    size_t length = 0;
    for (unsigned i = 0; i < sizeof(names) / sizeof(names[0]); ++i) if (mask & (1U << i))
        length += (size_t)snprintf(output + length, 200 - length, "%s\"%s\"", length ? "," : "", names[i]);
    output[length] = 0;
}

static void perf_summary(const char *reason) {
    if (!perf.enabled) return;
    char peaks[10000] = {0}; size_t used = 0;
    for (unsigned i = 0; i < perf.peak_count; ++i) {
        const PERF_PEAK *peak = &perf.peaks[i]; char signals[200]; perf_signals(peak->signals, signals);
        used += (size_t)snprintf(peaks + used, sizeof(peaks) - used,
            "%s{\"at\":\"%s\",\"elapsedMs\":%llu,\"intervalMs\":%llu,\"cpuOneCorePercent\":%.2f,\"privateBytes\":%llu,\"workingSetBytes\":%llu,\"readBytesPerSecond\":%.2f,\"writeBytesPerSecond\":%.2f,\"pageFaultsPerSecond\":%.2f,\"signals\":[%s]}",
            i ? "," : "", peak->at, peak->elapsed, peak->interval, peak->cpu_one_core,
            peak->private_bytes, peak->working_set, peak->read_rate, peak->write_rate, peak->faults_rate, signals);
    }
    BOOL helper_ok; uint64_t helper_cpu = perf_cpu_time(GetCurrentProcess(), &helper_ok);
    uint64_t helper_delta = helper_ok && helper_cpu >= perf.helper_cpu_start ? helper_cpu - perf.helper_cpu_start : 0;
    ULONGLONG elapsed = GetTickCount64() - perf.start_tick;
    perf_emit(TRUE, "performance-summary", ",\"reason\":\"%s\",\"startedAt\":\"%s\",\"requestedIntervalMs\":1000,\"maxDurationMs\":%llu,\"sampleCount\":%llu,\"validSamples\":{\"cpu\":%llu,\"memory\":%llu,\"io\":%llu,\"threads\":%llu,\"system\":%llu},\"frameTimesCollected\":false,\"frameTimesStatus\":\"separate-presentmon-required\",\"totals\":{\"cpuTime100ns\":%llu,\"cpuMeasuredMs\":%llu,\"readBytes\":%llu,\"writeBytes\":%llu,\"otherIoBytes\":%llu,\"pageFaults\":%llu},\"peaks\":{\"cpuOneCorePercent\":%.2f,\"cpuPercent\":%.2f,\"privateBytes\":%llu,\"workingSetBytes\":%llu,\"threadCount\":%llu,\"handleCount\":%llu,\"readBytesPerSecond\":%.2f,\"writeBytesPerSecond\":%.2f,\"pageFaultsPerSecond\":%.2f,\"sampleIntervalMs\":%llu},\"minimumAvailable\":{\"systemPhysicalBytes\":%llu,\"systemCommitBytes\":%llu},\"overhead\":{\"sampleWorkTotalMs\":%.3f,\"sampleWorkMaxMs\":%.3f,\"helperCpuTimeMs\":%.3f,\"helperCpuPercent\":%.4f},\"storage\":{\"fileLimitBytes\":%llu,\"retainedFiles\":2,\"rotations\":%llu,\"writeErrors\":%llu},\"topIntervals\":[%s],\"qpcFrequency\":\"%lld\",\"startQpc\":\"%lld\"",
        reason, perf.started_at, PERF_MAX_DURATION, perf.sample_count,
        perf.cpu_samples, perf.memory_samples, perf.io_samples, perf.thread_samples, perf.system_samples,
        perf.total_cpu_100ns, perf.cpu_measured_ms,
        perf.total_read, perf.total_write, perf.total_other, perf.total_faults, perf.peak_cpu_one_core,
        perf.peak_cpu_one_core / perf.logical_processors, perf.peak_private, perf.peak_working_set,
        perf.peak_thread_count, perf.peak_handles, perf.peak_read_rate, perf.peak_write_rate, perf.peak_faults_rate,
        perf.max_interval_ms, perf.min_system_physical == UINT64_MAX ? 0 : perf.min_system_physical,
        perf.min_system_commit == UINT64_MAX ? 0 : perf.min_system_commit,
        (double)perf.sample_cost_qpc * 1000 / perf.qpc_frequency.QuadPart,
        (double)perf.max_sample_cost_qpc * 1000 / perf.qpc_frequency.QuadPart,
        (double)helper_delta / 10000, elapsed ? (double)helper_delta / elapsed / 100 / perf.logical_processors : 0,
        PERF_LOG_LIMIT, perf.rotations, perf.log_write_errors, peaks, perf.qpc_frequency.QuadPart, perf.start_qpc.QuadPart);
}

static void perf_end(const char *reason) {
    if (!perf.enabled || !perf.running) return;
    perf.running = FALSE;
    perf_summary(reason);
    if (perf.log) { fclose(perf.log); perf.log = NULL; }
}

static void perf_begin(HANDLE process, DWORD pid, const wchar_t *directory) {
    memset(&perf, 0, sizeof(perf)); perf.enabled = TRUE; perf.running = TRUE;
    perf.process = process; perf.pid = pid; perf.start_tick = GetTickCount64();
    perf.next_summary = perf.start_tick + 30000;
    perf.min_system_physical = UINT64_MAX; perf.min_system_commit = UINT64_MAX;
    QueryPerformanceFrequency(&perf.qpc_frequency); QueryPerformanceCounter(&perf.start_qpc);
    if (perf.qpc_frequency.QuadPart <= 0) { perf.enabled = FALSE; perf.running = FALSE; return; }
    SYSTEM_INFO system; GetSystemInfo(&system); perf.logical_processors = system.dwNumberOfProcessors ? system.dwNumberOfProcessors : 1;
    BOOL cpu_ok; perf.helper_cpu_start = perf_cpu_time(GetCurrentProcess(), &cpu_ok);
    perf_timestamp(perf.started_at);
    swprintf(perf.log_path, PATH_CAP, L"%ls\\performance.jsonl", directory);
    swprintf(perf.summary_path, PATH_CAP, L"%ls\\performance-summary.json", directory);
    perf.log = _wfopen(perf.log_path, L"wb");
    if (!perf.log) ++perf.log_write_errors;
    perf_emit(FALSE, "performance-status", ",\"status\":\"recording\",\"source\":\"windows-process-counters\",\"requestedIntervalMs\":1000,\"maxDurationMs\":%llu,\"qpcFrequency\":\"%lld\",\"startQpc\":\"%lld\",\"logicalProcessors\":%u,\"journalAvailable\":%s,\"frameTimesCollected\":false,\"frameTimesStatus\":\"separate-presentmon-required\",\"pageFaultKind\":\"soft-and-hard\",\"ioKind\":\"all-process-io-not-disk-only\",\"fileLimitBytes\":%llu,\"retainedFiles\":2",
        PERF_MAX_DURATION, perf.qpc_frequency.QuadPart, perf.start_qpc.QuadPart, perf.logical_processors,
        perf.log ? "true" : "false", PERF_LOG_LIMIT);
    perf_summary("started");
}

static void perf_thread(int change) {
    if (!perf.running) return;
    if (change > 0) { ++perf.thread_count; ++perf.threads_created; }
    else if (change < 0) { if (perf.thread_count) --perf.thread_count; ++perf.threads_exited; }
}

static void perf_add_peak(const PERF_PEAK *peak) {
    unsigned position = 0;
    while (position < perf.peak_count && perf.peaks[position].score >= peak->score) ++position;
    if (position == PERF_TOP_COUNT) return;
    if (perf.peak_count < PERF_TOP_COUNT) ++perf.peak_count;
    for (unsigned i = perf.peak_count - 1; i > position; --i) perf.peaks[i] = perf.peaks[i - 1];
    perf.peaks[position] = *peak;
}

static void perf_tick(BOOL force) {
    if (!perf.running) return;
    ULONGLONG now = GetTickCount64();
    if (!force && now < perf.next_tick) return;
    if (now - perf.start_tick >= PERF_MAX_DURATION) { perf_end("duration-limit"); return; }
    LARGE_INTEGER work_started; QueryPerformanceCounter(&work_started);
    PROCESS_MEMORY_COUNTERS_EX memory = {0}; memory.cb = sizeof(memory);
    MEMORYSTATUSEX system = {0}; system.dwLength = sizeof(system);
    IO_COUNTERS io = {0}; BOOL cpu_ok;
    uint64_t cpu = perf_cpu_time(perf.process, &cpu_ok);
    BOOL memory_ok = GetProcessMemoryInfo(perf.process, (PROCESS_MEMORY_COUNTERS *)&memory, sizeof(memory));
    BOOL io_ok = GetProcessIoCounters(perf.process, &io);
    BOOL system_ok = GlobalMemoryStatusEx(&system);
    DWORD handles = 0; BOOL handles_ok = GetProcessHandleCount(perf.process, &handles);
    if (cpu_ok) ++perf.cpu_samples;
    if (memory_ok) ++perf.memory_samples;
    if (io_ok) ++perf.io_samples;
    if (perf.threads_known) ++perf.thread_samples;
    if (system_ok) ++perf.system_samples;
    ULONGLONG interval = perf.previous_tick ? now - perf.previous_tick : 0;
    double seconds = interval ? (double)interval / 1000 : 1;
    BOOL cpu_delta_ok = cpu_ok && perf.previous_cpu && interval > 0;
    BOOL memory_delta_ok = memory_ok && perf.previous_memory && interval > 0;
    BOOL io_delta_ok = io_ok && perf.previous_io && interval > 0;
    uint64_t cpu_delta = cpu_delta_ok && cpu >= perf.previous_cpu_time ? cpu - perf.previous_cpu_time : 0;
    DWORD fault_delta = memory_delta_ok ? memory.PageFaultCount - perf.previous_faults : 0;
    uint64_t read_delta = io_delta_ok && io.ReadTransferCount >= perf.previous_io_values.ReadTransferCount ? io.ReadTransferCount - perf.previous_io_values.ReadTransferCount : 0;
    uint64_t write_delta = io_delta_ok && io.WriteTransferCount >= perf.previous_io_values.WriteTransferCount ? io.WriteTransferCount - perf.previous_io_values.WriteTransferCount : 0;
    uint64_t other_delta = io_delta_ok && io.OtherTransferCount >= perf.previous_io_values.OtherTransferCount ? io.OtherTransferCount - perf.previous_io_values.OtherTransferCount : 0;
    int64_t private_delta = memory_delta_ok ? (int64_t)memory.PrivateUsage - (int64_t)perf.previous_private : 0;
    int64_t ws_delta = memory_delta_ok ? (int64_t)memory.WorkingSetSize - (int64_t)perf.previous_working_set : 0;
    double cpu_one_core = interval ? (double)cpu_delta / interval / 100 : 0;
    double read_rate = read_delta / seconds, write_rate = write_delta / seconds, faults_rate = fault_delta / seconds;
    unsigned signals = 0;
    if (cpu_delta_ok && cpu_one_core - perf.previous_cpu_one_core >= 50) signals |= 1;
    if (ws_delta <= -(int64_t)(32 * MIB)) signals |= 2;
    if (private_delta >= (int64_t)(64 * MIB)) signals |= 4;
    if (faults_rate >= 1000) signals |= 8;
    if (read_rate + write_rate >= 8 * MIB) signals |= 16;
    if (interval >= 1500) signals |= 32;
    char signal_names[200]; perf_signals(signals, signal_names);
    LARGE_INTEGER queried; QueryPerformanceCounter(&queried);
    perf_emit(FALSE, "performance-sample", ",\"sample\":%llu,\"intervalMs\":%llu,\"cpuAvailable\":%s,\"cpuDeltaAvailable\":%s,\"cpuPercent\":%.2f,\"cpuOneCorePercent\":%.2f,\"cpuTime100ns\":%llu,\"memoryAvailable\":%s,\"memoryDeltaAvailable\":%s,\"privateBytes\":%llu,\"privateDeltaBytes\":%lld,\"workingSetBytes\":%llu,\"workingSetDeltaBytes\":%lld,\"pageFaultCount\":%lu,\"pageFaultDelta\":%lu,\"pageFaultsPerSecond\":%.2f,\"ioAvailable\":%s,\"ioDeltaAvailable\":%s,\"ioReadBytes\":%llu,\"ioWriteBytes\":%llu,\"ioOtherBytes\":%llu,\"ioReadOperations\":%llu,\"ioWriteOperations\":%llu,\"readDeltaBytes\":%llu,\"writeDeltaBytes\":%llu,\"readBytesPerSecond\":%.2f,\"writeBytesPerSecond\":%.2f,\"threadsAvailable\":%s,\"threadCount\":%lu,\"threadsCreated\":%llu,\"threadsExited\":%llu,\"handlesAvailable\":%s,\"handleCount\":%lu,\"systemAvailable\":%s,\"systemPhysicalAvailableBytes\":%llu,\"systemCommitAvailableBytes\":%llu,\"queryCostMs\":%.3f,\"signals\":[%s]",
        ++perf.sample_count, interval, cpu_ok ? "true" : "false", cpu_delta_ok ? "true" : "false",
        cpu_one_core / perf.logical_processors, cpu_one_core, cpu, memory_ok ? "true" : "false",
        memory_delta_ok ? "true" : "false", (uint64_t)memory.PrivateUsage, private_delta,
        (uint64_t)memory.WorkingSetSize, ws_delta, (unsigned long)memory.PageFaultCount, (unsigned long)fault_delta,
        faults_rate, io_ok ? "true" : "false", io_delta_ok ? "true" : "false", io.ReadTransferCount,
        io.WriteTransferCount, io.OtherTransferCount, io.ReadOperationCount, io.WriteOperationCount,
        read_delta, write_delta, read_rate, write_rate, perf.threads_known ? "true" : "false",
        (unsigned long)perf.thread_count, perf.threads_created - perf.previous_created,
        perf.threads_exited - perf.previous_exited, handles_ok ? "true" : "false", (unsigned long)handles,
        system_ok ? "true" : "false", system.ullAvailPhys, system.ullAvailPageFile,
        (double)(queried.QuadPart - work_started.QuadPart) * 1000 / perf.qpc_frequency.QuadPart, signal_names);
    perf.total_cpu_100ns += cpu_delta; if (cpu_delta_ok) perf.cpu_measured_ms += interval;
    perf.total_read += read_delta; perf.total_write += write_delta; perf.total_other += other_delta; perf.total_faults += fault_delta;
    if (cpu_one_core > perf.peak_cpu_one_core) perf.peak_cpu_one_core = cpu_one_core;
    if (memory.PrivateUsage > perf.peak_private) perf.peak_private = memory.PrivateUsage;
    if (memory.WorkingSetSize > perf.peak_working_set) perf.peak_working_set = memory.WorkingSetSize;
    if (perf.thread_count > perf.peak_thread_count) perf.peak_thread_count = perf.thread_count;
    if (handles > perf.peak_handles) perf.peak_handles = handles;
    if (read_rate > perf.peak_read_rate) perf.peak_read_rate = read_rate;
    if (write_rate > perf.peak_write_rate) perf.peak_write_rate = write_rate;
    if (faults_rate > perf.peak_faults_rate) perf.peak_faults_rate = faults_rate;
    if (interval > perf.max_interval_ms) perf.max_interval_ms = interval;
    if (system_ok && system.ullAvailPhys < perf.min_system_physical) perf.min_system_physical = system.ullAvailPhys;
    if (system_ok && system.ullAvailPageFile < perf.min_system_commit) perf.min_system_commit = system.ullAvailPageFile;
    if (interval) {
        PERF_PEAK peak = {0}; peak.elapsed = now - perf.start_tick; peak.interval = interval; perf_timestamp(peak.at);
        peak.cpu_one_core = cpu_one_core; peak.read_rate = read_rate; peak.write_rate = write_rate;
        peak.faults_rate = faults_rate; peak.private_bytes = memory.PrivateUsage; peak.working_set = memory.WorkingSetSize;
        peak.signals = signals; peak.score = cpu_one_core / 10 + faults_rate / 250 + (read_rate + write_rate) / MIB + (ws_delta < 0 ? -(double)ws_delta / MIB : 0) + (interval > 1200 ? interval / 100.0 : 0);
        perf_add_peak(&peak);
    }
    perf.previous_tick = now; perf.next_tick = now + PERF_INTERVAL;
    perf.previous_cpu = cpu_ok; perf.previous_cpu_time = cpu; perf.previous_cpu_one_core = cpu_one_core;
    perf.previous_memory = memory_ok; perf.previous_private = memory.PrivateUsage; perf.previous_working_set = memory.WorkingSetSize; perf.previous_faults = memory.PageFaultCount;
    perf.previous_io = io_ok; perf.previous_io_values = io;
    perf.previous_created = perf.threads_created; perf.previous_exited = perf.threads_exited;
    LARGE_INTEGER finished; QueryPerformanceCounter(&finished);
    uint64_t cost = (uint64_t)(finished.QuadPart - work_started.QuadPart); perf.sample_cost_qpc += cost;
    if (cost > perf.max_sample_cost_qpc) perf.max_sample_cost_qpc = cost;
    if (now >= perf.next_summary) { perf_summary("periodic"); perf.next_summary = now + 30000; }
}

#endif
