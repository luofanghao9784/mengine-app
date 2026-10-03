/** Product-owned projection: no provider or Harness types cross this boundary. */
export interface LiveInput {
  id: string;
  text: string;
}
export interface LiveQuestion {
  text: string;
  options: string[];
  blocking: boolean;
}
export interface RealtimePort {
  started?(): Promise<void>;
  control(): Promise<{ stop: boolean; inputs: LiveInput[] }>;
  applied(id: string): Promise<void>;
  output(step: number, text: string, state: 'STREAMING' | 'COMPLETE' | 'INTERRUPTED'): Promise<void>;
}
