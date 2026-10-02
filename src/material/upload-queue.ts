import {
  BatchUploadRun,
  permissionError,
  uploadError,
  type BatchDestination,
  type BatchFile,
  type BatchTransport,
} from './batch-upload.ts';

export interface UploadJob {
  id: string;
  label: string;
  href: string;
  run: BatchUploadRun;
  state: 'queued' | 'running' | 'paused' | 'done';
  mode: 'ready' | 'retry';
  stopping: boolean;
  error?: string;
}
/** Owned by the authenticated tenant shell, not an individual library page or dialog. */
export class UploadQueue {
  jobs: UploadJob[] = [];
  revision = 0;
  private disposed = false;
  private pumping = false;
  private controller = new AbortController();
  private listeners = new Set<() => void>();
  private api: BatchTransport;
  constructor(api: BatchTransport) {
    this.api = api;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.revision;
  private changed = () => {
    this.revision++;
    this.listeners.forEach((listener) => listener());
  };
  add(destination: BatchDestination, rows: BatchFile[], label: string, href: string) {
    if (this.disposed || !rows.some((row) => row.selected && !row.problem)) return;
    this.jobs.push({
      id: crypto.randomUUID(),
      label,
      href,
      run: new BatchUploadRun(destination, rows),
      state: 'queued',
      mode: 'ready',
      stopping: false,
    });
    this.changed();
    void this.pump();
  }
  pause(job: UploadJob) {
    if (job.state === 'running') {
      job.stopping = true;
      job.run.stop();
    } else if (job.state === 'queued') job.state = 'paused';
    this.changed();
  }
  resume(job: UploadJob, mode: 'ready' | 'retry') {
    if (this.disposed || job.state === 'running' || job.state === 'queued') return;
    job.state = 'queued';
    job.mode = mode;
    job.error = undefined;
    job.stopping = false;
    this.changed();
    void this.pump();
  }
  dismiss(job: UploadJob) {
    if (job.state === 'running' || job.state === 'queued') return;
    this.jobs = this.jobs.filter((j) => j !== job);
    this.changed();
  }
  dispose() {
    this.disposed = true;
    this.jobs.forEach((job) => job.run.stop());
    this.controller.abort();
    this.jobs = [];
    this.changed();
    this.listeners.clear();
  }
  private async pump() {
    if (this.pumping || this.disposed) return;
    this.pumping = true;
    try {
      let job: UploadJob | undefined;
      while (!this.disposed && (job = this.jobs.find((j) => j.state === 'queued'))) {
        job.state = 'running';
        job.stopping = false;
        this.changed();
        try {
          await job.run.execute(this.api, job.mode, this.changed, this.controller.signal);
        } catch (error) {
          job.error = uploadError(error);
          // A revoked target must not silently send later queued tasks either.
          if (permissionError(error))
            this.jobs
              .filter((j) => j.state === 'queued')
              .forEach((j) => {
                j.state = 'paused';
              });
        }
        if (this.disposed) break;
        job.state = job.run.files.every((row) => row.state === 'succeeded') ? 'done' : 'paused';
        job.stopping = false;
        this.changed();
      }
    } finally {
      this.pumping = false;
    }
  }
}
