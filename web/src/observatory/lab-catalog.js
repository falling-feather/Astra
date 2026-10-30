import snapshot from '../data/lab-catalog.json' with {type:'json'};

const galaxyIds=Object.freeze({englab:'engineering','code-space':'code','future-galaxy':'future'});
export const LAB_SPACES=Object.freeze(snapshot.spaces.map(space=>Object.freeze({...space,topics:Object.freeze(space.topics.map(topic=>Object.freeze({...topic,
  objectives:Object.freeze(topic.objectives),activities:Object.freeze(topic.activities.map(activity=>Object.freeze(activity))),
})))})));
export const LAB_SOURCE=Object.freeze(snapshot.source);
const activities=new Map();
for(const space of LAB_SPACES)for(const topic of space.topics)for(const activity of topic.activities){
  activities.set(activity.key,Object.freeze({...activity,galaxyId:galaxyIds[space.key],topicId:topic.id,topicTitle:topic.title,spaceTitle:space.title}));
}
export const findLabActivity=key=>activities.get(key)||null;
export function experimentHref(key){
  if(!activities.has(key))throw new RangeError('未知实验。');
  return './experiment.html?activity='+encodeURIComponent(key);
}
export function resolveExperimentRoute(search,baseUrl){
  const key=new URLSearchParams(search).get('activity'),activity=findLabActivity(key);
  if(!activity)return null;
  const base=new URL(baseUrl);
  return {activity,iframeUrl:new URL(activity.href,base).href,
    returnHref:new URL(`observatory.html#galaxy=${activity.galaxyId}&subject=${encodeURIComponent(activity.topicId)}`,base).href};
}
export function filterLabActivities(list,query){
  const terms=String(query??'').normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return list.filter(item=>{const text=`${item.title} ${item.summary}`.normalize('NFKC').toLowerCase();return terms.every(term=>text.includes(term));});
}
