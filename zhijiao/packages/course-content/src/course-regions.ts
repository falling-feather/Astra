import { xunpuCourseRelease } from "./xunpu-course.js";
import { villageSuperCourseRelease } from "./village-super-course.js";
import { villagePostpublicationCourseRelease } from "./village-postpublication-case.js";
import { aiCopyrightCourseRelease } from "./ai-copyright-course.js";
import { rainEmergencyCourseRelease } from "./rain-emergency-course.js";

/** Display and region membership belong to the course catalog, not to browser title heuristics. */
export const courseRegionAssignments = [
  { courseId: xunpuCourseRelease.releaseRef.courseId, regionId: "xunpu", regionTitle: "蟳埔", shortTitle: "社区深度采访", summary: "走进社区，寻找热闹画面之外的故事。由你决定先见谁、如何核实，以及怎样呈现不同人的生活。", coverIndex: 0, order: 1 },
  { courseId: villageSuperCourseRelease.releaseRef.courseId, regionId: "rongjiang", regionTitle: "榕江", shortTitle: "赛事采编", summary: "从赛场边线到社区街巷，找到一场比赛值得讲述的细节，把采访与观察做成适合不同平台的报道。", coverIndex: 1, order: 2 },
  { courseId: villagePostpublicationCourseRelease.releaseRef.courseId, regionId: "rongjiang", regionTitle: "榕江", shortTitle: "发布与回应", summary: "一条已经发布的短视频引来质疑。回访当事人、核对完整语境，决定如何回应公众并更新作品。", coverIndex: 2, order: 3 },
  { courseId: aiCopyrightCourseRelease.releaseRef.courseId, regionId: "qinglan", regionTitle: "山地景区", shortTitle: "素材与版权", summary: "一组好看的画面能直接使用吗？沿素材的来路走访制作人，厘清生成属性、许可范围和表达选择。", coverIndex: 3, order: 4 },
  { courseId: rainEmergencyCourseRelease.releaseRef.courseId, regionId: "qinglan", regionTitle: "山地景区", shortTitle: "暴雨服务报道", summary: "天气变化，公告不断更新。辨认已经确认的范围，为不同处境的游客制作清楚、及时的服务信息。", coverIndex: 4, order: 5 },
] as const;
