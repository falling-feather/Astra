import type { TeacherGateway } from '../teacher-gateway';
import type { TeachingAuthorContext, TeachingTaskGateway } from '../teaching-task-gateway';
import { TeachingTaskDesigner } from './teaching-task-designer';
import { CharacterStudioPage } from './character-studio';
export default function TeacherCoursesPage({ taskGateway, context, navigate }: {
  gateway: TeacherGateway; taskGateway: TeachingTaskGateway; context: TeachingAuthorContext; navigate(path:string):void;
}) {
  return <><CharacterStudioPage gateway={taskGateway} context={context}/><details className="studio-legacy-task"><summary>岗位委托转为教学任务 · 任务设计与发布</summary><TeachingTaskDesigner gateway={taskGateway} context={context} navigate={navigate}/></details></>;
}
