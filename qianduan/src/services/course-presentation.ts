import type { Course } from '../domain/models';
import type { WorkbenchCourse } from '../portal/contracts';

const subjects: Record<string, { name: string; color: string }> = {
  mathematics: { name: '数学', color: '#70d5e4' },
  physics: { name: '物理', color: '#b7b9ea' },
  chemistry: { name: '化学', color: '#83b6e1' },
  algorithms: { name: '算法', color: '#78ccb3' },
  biology: { name: '生物', color: '#d7b57a' },
};
export function presentCourse(item: WorkbenchCourse): Course {
  const subject = subjects[item.subject_key] || {
    name: item.galaxy_key === 'code-space' ? '编程' : '跨学科',
    color: '#a6b3e9',
  };
  const match = (item.schedule_text || '').match(
    /(?:周|星期)([一二三四五六日天])\s*(\d{1,2}:\d{2})\s*[—–-]\s*(\d{1,2}:\d{2})/,
  );
  return {
    id: String(item.course_id),
    backendId: item.course_id,
    title: item.title,
    teacher: item.teacher_display_name || '授课教师',
    subject: subject.name,
    color: subject.color,
    secondary: '#20384f',
    galaxyKey: item.galaxy_key,
    subjectKey: item.subject_key,
    scheduleText: item.schedule_text || '时间待安排',
    schedule: {
      weekday: match ? '一二三四五六日'.indexOf(match[1].replace('天', '日')) : -1,
      start: match?.[2] || '',
      end: match?.[3] || '',
      room: '',
    },
    completed: item.completed_unit_count || 0,
    lessons: item.published_unit_count || 0,
    description: item.summary || '进入课程查看已发布的学习内容。',
    chapters: [],
  };
}
