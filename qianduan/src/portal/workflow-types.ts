import type * as D from './api-v2.generated';

export type * from './api-v2.generated';

/** Commands keep their request identifier until the server result is known. */
export interface WorkflowGateway {
  courses(): Promise<D.CourseWorkflowRead[]>;
  course(id: number): Promise<D.CourseWorkflowRead>;
  create(input: D.CourseCreateCommand): Promise<D.CourseWorkflowRead>;
  draft(id: number): Promise<D.CourseDraftReadV2>;
  save(id: number, input: D.CourseDraftCommand): Promise<D.CourseDraftReadV2>;
  fork(id: number, input: D.CourseForkCommand): Promise<D.CourseForkRead>;
  revisions(id: number, offset?: number): Promise<D.CourseRevisionPageRead>;
  preview(id: number, input: D.SubmissionPreviewCommand): Promise<D.SubmissionPreviewRead>;
  submit(id: number, input: D.SubmitCandidateCommand): Promise<D.SubmissionReceiptRead>;
  candidates(filters?: { course_id?: number; status?: string; offset?: number; batch_id?: number }): Promise<D.CandidatePageRead>;
  candidate(id: number): Promise<D.CandidateDetailRead>;
  review(input: D.ReviewCommand): Promise<D.ReviewReceiptRead>;
  withdraw(id: number, input: D.WithdrawCommand): Promise<D.CandidateActionRead>;
  publish(input: D.PublishCommand): Promise<D.PublicationReceiptRead>;
  restore(id: number, input: D.RestoreDraftCommand): Promise<D.CourseDraftReadV2>;
  receipt(key: string): Promise<D.WorkflowReceiptRead>;
  media(id: number, offset?: number): Promise<D.CourseMediaPage>;
  upload(id: number, file: File, key: string): Promise<D.CourseMediaRead>;
  mediaUrl(courseId: number, key: string, releaseId?: number, unitId?: number): string;
}
