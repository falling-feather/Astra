import type { Role, SchoolGateway, TeacherApplication } from '../portal/contracts';
export type WorkspaceView =
  'overview' | 'courses' | 'classes' | 'notes' | 'account' | 'assignments' | 'teaching' | 'course';
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
  backendId?: number;
  galaxyKey?: string;
  subjectKey?: string;
  scheduleText?: string;
}

export interface LearningTask {
  id: string;
  courseId: string;
  title: string;
  description: string;
  due: string;
  completed: boolean;
  assignmentId?: number;
  classId?: number;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  modified: string;
  revision?: number;
}

/** Cookie API and explicit demonstration adapters share this view-facing boundary. */
export interface LearningGateway {
  readonly mode: 'demo' | 'api';
  readonly school: SchoolGateway;
  getSession(): Promise<Session | null>;
  signIn(name: string, password: string): Promise<Session>;
  enterAsGuest(role?: Role): Promise<Session>;
  register(name: string, displayName: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  updateDisplayName(name: string): Promise<Session>;
  getCourses(): Promise<Course[]>;
  getTasks(): Promise<LearningTask[]>;
  getNotes(offset?: number): Promise<Note[]>;
  createNote(): Promise<Note>;
  saveNote(note: Note): Promise<Note>;
  deleteNote(note: Note): Promise<void>;
}

export interface AppState {
  teacherApplication?: TeacherApplication | null;
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
  noteDirty?: boolean;
  moreNotes?: boolean;
  openCourseId?: number;
  openAssignmentId?: number;
  openAssignmentClassId?: number;
}
