export type WorkspaceView = 'overview' | 'courses' | 'classes' | 'notes' | 'account';
export type Destination = 'manage' | 'lab' | 'code' | 'future';
export type View = WorkspaceView | Destination;
export type Phase = 'intro' | 'welcome' | 'login' | 'workspace';

export interface Session {
  displayName: string;
  kind: 'guest' | 'member';
  source: 'demo' | 'server';
  userId?: string | number;
  role?: 'student' | 'teacher' | 'admin';
}

export type DemoSession = Session & { source: 'demo' };

export interface Course {
  id: string;
  title: string;
  subject: string;
  teacher: string;
  color: string;
  secondary: string;
  schedule: { weekday: number; start: string; end: string; room: string };
  completed: number;
  lessons: number;
  description: string;
  chapters: string[];
}

export interface LearningTask {
  id: string;
  courseId: string;
  title: string;
  description: string;
  due: string;
  completed: boolean;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  modified: string;
}

/** A future HTTP adapter implements this boundary; views do not own transport. */
export interface LearningGateway {
  getSession(): Promise<Session | null>;
  signIn(name: string, password: string): Promise<Session>;
  enterAsGuest(): Promise<Session>;
  signOut(): Promise<void>;
  updateDisplayName(name: string): Promise<Session>;
  getCourses(): Promise<Course[]>;
  getTasks(): Promise<LearningTask[]>;
  completeTask(id: string): Promise<void>;
}

export interface AppState {
  phase: Phase;
  view: View;
  session: Session | null;
  sidebarCollapsed: boolean;
  courses: Course[];
  tasks: LearningTask[];
  selectedCourse: string;
  calendarMonth: Date;
  selectedDate: Date;
  weekOffset: number;
  notes: Note[];
  activeNote: string;
  reducedMotion: boolean;
}
