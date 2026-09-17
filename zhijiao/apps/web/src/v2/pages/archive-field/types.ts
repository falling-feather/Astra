export interface ArchiveDossier {
  id: string;
  title: string;
  region: string;
  subtitle: string;
  duration?: string;
  coverIndex: number;
  status?: string;
  actionLabel: string;
  collection?: string;
  details?: Array<{title: string; text?: string; items?: readonly string[]}>;
}
