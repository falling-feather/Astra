import type * as D from './api-v2.generated';

export type * from './api-v2.generated';

/** Each write refers to the version and revision that the learner or teacher saw. */
export interface StudyGateway {
  start(input: D.LearningContextStart): Promise<D.LearningContextRead>;
  context(key: string): Promise<D.LearningContextRead>;
  checkpoint(
    key: string,
    checkpoint: string,
    input: D.ContextCheckpointAnswer,
  ): Promise<D.ContextCheckpointRead>;
  history(course: number, offset?: number, student?: number): Promise<D.LearningHistoryPage>;
  contexts(course: number): Promise<D.LearningResumeRead[]>;
  openAssignment(id: number, input: D.AssignmentOpenCommand): Promise<D.AssignmentWorkspaceRead>;
  submit(id: number, input: D.AssignmentAttemptCommand): Promise<D.AssignmentAttemptRead>;
  grade(attempt: number, input: D.AssignmentGradeCommand): Promise<D.AssignmentGradeRead>;
  submissionHistory(id: number, offset?: number): Promise<D.AssignmentHistoryRead>;
}
