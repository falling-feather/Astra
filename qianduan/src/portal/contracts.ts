export type Role = 'student' | 'teacher' | 'admin';
export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  next_offset: number | null;
}
export interface School {
  id: number;
  name: string;
  status: string;
  version: number;
  region?: string | null;
}
export interface Classroom {
  id: number;
  school_id: number;
  name: string;
  kind: 'homeroom' | 'course_cohort';
  grade: string | null;
  term: string | null;
  status: string;
  version: number;
}
export interface Member {
  id: number;
  user_id: number;
  username: string;
  display_name: string;
  role: string;
  status: string;
}
export interface ClassRequest {
  id: number;
  class_id: number;
  user_id: number;
  role: string;
  status: string;
  message: string | null;
}
export interface Information {
  teacher_ids_snapshot?: number[];
  id: number;
  revision_number: number;
  edit_revision: number;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  review_note: string | null;
  information_snapshot: Omit<CourseInput, 'school_id' | 'collaborator_user_ids'>;
  submitted_at: string | null;
}
export interface CourseInput {
  school_id: number;
  title: string;
  summary: string | null;
  academic_year: string;
  schedule_text: string;
  total_hours: number;
  galaxy_key: string;
  subject_key: string;
  admission_mode: 'open' | 'class_restricted';
  collaborator_user_ids: number[];
  admission_class_ids: number[];
}
export interface CourseInfo extends Omit<CourseInput, 'collaborator_user_ids' | 'admission_class_ids'> {
  id: number;
  creator_user_id: number;
  course_code: string | null;
  status: string;
  teachers: { user_id: number; display_name: string; is_creator: boolean; role: string }[];
  admission_classes: { class_id: number; name: string }[];
  information_revision: Information;
  has_published_content: boolean;
  active_student_count: number;
}
export interface Activity {
  key: string;
  title: string;
  galaxy: string;
  subject: string;
  href: string;
}
export interface Block {
  blockId: string;
  type: 'hero' | 'learning-task' | 'rich-text' | 'media' | 'official-simulation' | 'checkpoint' | 'sources';
  title?: string;
  summary?: string;
  prompt?: string;
  markdown?: string;
  instructions?: string;
  simulationKey?: string;
  checkpointKey?: string;
  responseType?: 'single-choice' | 'multiple-choice' | 'numeric' | 'short-text';
  choices?: { choiceId: string; label: string }[];
  correctChoiceIds?: string[];
  acceptedAnswers?: string[];
  numericAnswer?: number;
  tolerance?: number;
  maxAttempts?: number | null;
  mode?: string;
  questionSetKey?: string;
  steps?: string[];
  outcomes?: string[];
  concepts?: string[];
  assetKey?: string;
  alt?: string;
  caption?: string;
  items?: { sourceId: string; label: string; url: string }[];
}
export interface ContentPage {
  schemaVersion: 'astra-content-page-v2';
  slug: string;
  galaxy: string;
  subject: string;
  title: string;
  summary: string;
  layout: string;
  status: string;
  version: string;
  blocks: Block[];
  courseUnit?: {
    courseId: string;
    unitId: string;
    order: number;
    title: string;
    completion?: {
      preset: 'experiment_operation' | 'checkpoint_passed' | 'assignment_reviewed';
      checkpointKey?: string;
      assignmentId?: number;
    } | null;
  } | null;
}
export interface DraftUnit {
  id?: number;
  activity_key: string;
  title: string;
  position: number;
  content: ContentPage | null;
  revision?: number;
}
export interface SharedDraft {
  course_id: number;
  revision: number;
  status: string;
  title: string;
  summary: string | null;
  units: DraftUnit[];
}
export interface ReleaseUnit {
  access_state?: 'open' | 'locked';
  lock_reasons?: string[];
  id: number;
  source_course_unit_id: number;
  activity_key: string;
  title: string;
  position: number;
  content: ContentPage;
  content_schema_sha256: string;
}
export interface Release {
  id: number;
  course_id: number;
  release_number: number;
  draft_revision: number;
  title: string;
  summary: string | null;
  published_at: string;
  package_sha256: string;
  completion_rule_sha256: string;
  units: ReleaseUnit[];
}
export interface Assignment {
  id: number;
  unit_id: number;
  title: string;
  description: string | null;
  due_at: string | null;
  max_score: number;
  status: string;
  audience_mode: string;
  effective_class_id?: number;
  unit_release_state?: string;
}
export interface AssignmentInput {
  title: string;
  description: string;
  due_at: string | null;
  max_score: number;
  status: 'active' | 'closed';
  audience_mode: 'all_attached_classes' | 'selected_classes';
}
export interface Submission {
  id: number;
  assignment_id: number;
  student_id: number;
  class_id: number;
  content: { answer?: string; [key: string]: unknown };
  status: 'submitted' | 'graded' | 'returned';
  score: number | null;
  feedback: string | null;
  submitted_at: string;
  graded_at: string | null;
}
export interface StudentAssignment {
  class: Classroom;
  course: { id: number; title: string; galaxy_key: string; subject_key: string };
  unit: { id: number; title: string; activity_key: string };
  assignment: Assignment;
  submission: Submission | null;
  can_submit: boolean;
  read_only: boolean;
  submit_block_reason: string | null;
}
export interface Enrollment {
  id: number;
  student_id: number;
  display_name: string;
  source_class_name: string;
  status: string;
}
export interface JoinRequest extends Enrollment {
  course_id: number;
  message: string | null;
  created_at: string;
}
export interface Discovery {
  course_id: number;
  course_code: string;
  title: string;
  summary: string | null;
  teachers: { display_name: string }[];
  can_request: boolean;
  eligibility_reason: string;
  eligible_source_classes: { class_id: number; name: string }[];
}
export interface TeacherApplication {
  id: number;
  user_id: number;
  applicant_username: string;
  applicant_display_name: string;
  applicant_role: string;
  status: string;
  message: string | null;
  review_note: string | null;
}
export interface CourseReview {
  revision: Information;
  course_id: number;
  course_title?: string;
  proposed_information: CourseInput;
  changed_fields: string[];
  current_information: CourseInput | null;
}
export interface AdminUser {
  id: number;
  username: string;
  display_name: string;
  role: Role;
  status: string;
}
export interface ReleasePlan {
  course_id: number;
  class_id: number;
  plan_version: number;
  items: {
    course_unit_id: number;
    activity_key: string;
    position: number;
    release_mode: 'open' | 'locked' | 'hidden';
    open_at: string | null;
    prerequisite_unit_id: number | null;
  }[];
}
export interface WorkbenchCourse {
  course_id: number;
  title: string;
  course_code?: string | null;
  galaxy_key: string;
  subject_key: string;
  schedule_text?: string | null;
  summary?: string | null;
  teacher_display_name?: string | null;
  published_unit_count?: number;
  completed_unit_count?: number;
  status?: string;
  current_release_number?: number;
  content_draft_revision?: number;
  has_unpublished_changes?: boolean;
  active_student_count?: number;
  pending_student_count?: number;
}
export interface Workbench {
  role: Role;
  courses?: Page<WorkbenchCourse>;
  assignments?: Page<{
    assignment_id: number;
    course_id: number;
    course_title: string;
    title: string;
    state: string;
    due_at: string | null;
  }>;
  homerooms?: Page<{ class_id: number; name: string }>;
  pending_students?: Page<{
    request_id: number;
    course_id: number;
    course_title: string;
    student_display_name: string;
    source_class_name: string;
  }>;
  pending_grading?: Page<{
    submission_id: number;
    class_id: number;
    assignment_id: number;
    assignment_title: string;
    course_id: number;
    course_title: string;
    student_display_name: string;
  }>;
  unpublished_drafts?: Page<{ course_id: number; course_title: string; content_draft_revision: number }>;
  pending_teacher_applications?: Page<{
    application_id: number;
    user_id: number;
    username: string;
    display_name: string;
    message?: string | null;
  }>;
  pending_course_revisions?: Page<{ revision_id: number; course_id: number; course_title: string }>;
  catalog_totals?: { users: number; courses: number; active_schools: number; active_homerooms: number };
  section_errors: { section: string; message: string }[];
}

export interface SchoolGateway {
  authoringOptions(schoolId: number): Promise<{
    teachers: { user_id: number; display_name: string }[];
    homerooms: { class_id: number; name: string; grade: string | null; term: string | null }[];
  }>;
  workbench(): Promise<Workbench>;
  schools(): Promise<School[]>;
  createSchool(name: string): Promise<School>;
  classes(): Promise<Classroom[]>;
  courseClasses(id: number): Promise<Classroom[]>;
  createClass(schoolId: number, name: string, grade: string, term: string): Promise<Classroom>;
  members(classId: number, offset?: number): Promise<Page<Member>>;
  classRequests(classId: number): Promise<ClassRequest[]>;
  requestClass(classId: number, role: Role, message: string): Promise<unknown>;
  reviewClass(classId: number, requestId: number, status: string): Promise<unknown>;
  teacherCourses(): Promise<CourseInfo[]>;
  course(id: number): Promise<CourseInfo>;
  createCourse(input: CourseInput): Promise<CourseInfo>;
  reviseCourse(id: number, input: CourseInput): Promise<CourseInfo>;
  submitInformation(id: number, revisionId: number): Promise<CourseInfo>;
  editInformation(
    id: number,
    revisionId: number,
    expectedRevision: number,
    input: CourseInput,
  ): Promise<CourseInfo>;
  draft(id: number): Promise<SharedDraft>;
  saveDraft(id: number, draft: SharedDraft): Promise<SharedDraft>;
  releases(id: number): Promise<Release[]>;
  publish(id: number, revision: number, note: string): Promise<{ release: Release }>;
  currentRelease(id: number): Promise<{ release: Release }>;
  enrollments(id: number, offset?: number): Promise<Page<Enrollment>>;
  joinRequests(id: number, offset?: number): Promise<Page<JoinRequest>>;
  reviewJoin(courseId: number, requestId: number, status: string): Promise<JoinRequest>;
  removeEnrollment(courseId: number, enrollmentId: number): Promise<unknown>;
  discover(code: string): Promise<Discovery>;
  requestCourse(id: number, classId: number | null, message: string): Promise<JoinRequest>;
  assignments(id: number): Promise<Assignment[]>;
  createAssignment(courseId: number, unitId: number, input: AssignmentInput): Promise<Assignment>;
  studentAssignments(filter: string, offset?: number): Promise<Page<StudentAssignment>>;
  submitAssignment(id: number, classId: number, answer: string): Promise<Submission>;
  submissions(assignmentId: number, classId?: number, offset?: number): Promise<Page<Submission>>;
  grade(id: number, score: number, feedback: string, status: 'graded' | 'returned'): Promise<Submission>;
  releasePlan(courseId: number, classId: number): Promise<ReleasePlan>;
  saveReleasePlan(plan: ReleasePlan): Promise<ReleasePlan>;
  teacherApplications(offset?: number): Promise<Page<TeacherApplication>>;
  myTeacherApplication(): Promise<TeacherApplication | null>;
  applyTeacher(message: string): Promise<TeacherApplication>;
  reviewTeacher(id: number, status: string, note: string): Promise<TeacherApplication>;
  courseReviews(offset?: number): Promise<Page<CourseReview>>;
  reviewCourse(id: number, status: string, note: string): Promise<unknown>;
  adminUsers(offset?: number): Promise<Page<AdminUser>>;
  updateUser(
    id: number,
    patch: Partial<Pick<AdminUser, 'status' | 'role' | 'display_name'>>,
  ): Promise<AdminUser>;
  checkpoint(
    courseId: number,
    unitId: number,
    key: string,
    payload: Record<string, unknown>,
  ): Promise<{ is_correct: boolean; completed: boolean; remaining_attempts: number | null }>;
}
