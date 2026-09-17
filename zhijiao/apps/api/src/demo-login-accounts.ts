import type {DemoLoginAccount} from '@ronggang/contracts';
import {getDemoProfile} from './session-control-bootstrap.js';

// Intentionally public credentials for the judge demo, never deployment secrets.
const accounts=[
  {username:'teacher',profileId:'teacher-demo',role:'teacher',classrooms:['地方文旅融媒体 A 班','地方文旅融媒体 B 班']},
  {username:'student1',profileId:'student-unassigned',role:'student',classrooms:['地方文旅融媒体 A 班']},
  {username:'student2',profileId:'student-team-a',role:'student',classrooms:['地方文旅融媒体 A 班']},
  {username:'student3',profileId:'student-team-b',role:'student',classrooms:['地方文旅融媒体 B 班']},
] as const;
export function demoLoginAccounts():DemoLoginAccount[]{
  return accounts.map(account=>({...account,classrooms:[...account.classrooms],password:'Demo2026',displayName:getDemoProfile(account.profileId).displayName}));
}
