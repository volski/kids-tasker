export interface Task {
  id: string;
  title: string;
  icon: string;
  completed: boolean;
  completedAt: string | null;
  pendingApproval: boolean;
  requiresApproval: boolean;
  audioFeedback: string;
  enabled: boolean;
}

export interface TaskDelta {
  childId: string;
  taskId: string;
  changes: Partial<Task>;
}

export interface Child {
  id: string;
  name: string;
  tasks: Task[];
}

export interface HassConfig {
  enabled: boolean;
  url: string;
  token: string;
  tvEntityId: string;
  autoBlockTv: boolean;
  pollIntervalSeconds: number;
  targetScope: string;
  parentBypass?: boolean;
}

export interface AudioPreset {
  id: string;
  type: 'tts' | 'audio';
  name: string;
  value: string;
  voice?: 'male' | 'female';
}

export interface AudioSettings {
  onComplete: string;
  onPending: string;
  presets: AudioPreset[];
}

export interface BypassDayConfig {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

export interface BypassSchedule {
  enabled: boolean;
  schedule: { [day: string]: BypassDayConfig };
}

export interface Settings {
  resetTime: string;
  audio: AudioSettings;
  bypassSchedule: BypassSchedule;
}

export interface HistoryEntry {
  id: string;
  date: string;
  timestamp: string;
  childId: string;
  childName: string;
  taskId: string;
  taskTitle: string;
  icon: string;
  completed: boolean;
  completedAt: string | null;
  pendingApproval: boolean;
}

export interface AppData {
  children: Child[];
  homeAssistant: HassConfig;
  parentPin: string | null;
  settings: Settings;
  history?: HistoryEntry[];
  lastActiveDate?: string;
}

export interface Icon {
  id: string;
  name: string;
  emoji: string;
}
