import type { DataChartConfig, FunctionGraphConfig, ResourceInstallationRead, ResourcePage, ResourcePreviewRead, ResourceVersionRead } from './api-v2.generated';

export type { DataChartConfig, FunctionGraphConfig, ResourcePage, ResourcePreviewRead, ResourceVersionRead };
export type TemplateConfiguration = FunctionGraphConfig | DataChartConfig | Record<string, never>;

export interface ResourceGateway {
  list(space?: string, kind?: string, offset?: number): Promise<ResourcePage>;
  version(id: number): Promise<ResourceVersionRead>;
  preview(id: number, configuration: TemplateConfiguration): Promise<ResourcePreviewRead>;
  install(): Promise<ResourceInstallationRead>;
}

export interface TemplateSeed {
  kind?: 'template' | 'activity';
  version_number?: number;
  key: string;
  space: string;
  subject: string;
  title: string;
  renderer: string;
  definition: Record<string, unknown>;
  capabilities: Record<string, unknown>;
  provenance: Record<string, unknown>;
}
