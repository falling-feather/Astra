import {z} from 'zod';

export const DemoLoginAccountSchema=z.object({
  username:z.string().min(1),password:z.string().min(1),profileId:z.string().min(1),
  displayName:z.string().min(1),role:z.enum(['student','teacher']),classrooms:z.array(z.string()).min(1),
}).strict();
export const DemoLoginCatalogSchema=z.object({accounts:z.array(DemoLoginAccountSchema)}).strict();
export type DemoLoginAccount=z.infer<typeof DemoLoginAccountSchema>;
export const DemoLoginRequestSchema=z.object({username:z.string().trim().min(1).max(80),password:z.string().min(1).max(120),role:z.enum(['student','teacher'])}).strict();
