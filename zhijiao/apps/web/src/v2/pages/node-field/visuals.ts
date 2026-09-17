import type { FieldExplorationViewV4, FieldInterviewViewV1 } from "@ronggang/contracts";
export type FieldNode = FieldExplorationViewV4["nodes"][number];
export type FieldPerson = FieldNode["people"][number];
export interface FieldVisualPerson {
  entityId: string; displayName: string; professionalRole: string; portrait?: string;
  status: string; presence: { visible: boolean; canContact: boolean };
  appearance?: FieldInterviewViewV1["people"][number]["appearance"];
}
export interface FieldVisualNode { sceneRef: string; title: string; environmentImage: string; people: FieldVisualPerson[];
  imageAtlas?: { columns: number; rows: number; index: number } }
export type Point = { x: number; y: number };
export type FieldActor = Point & { entityId: string; height: number; atlas: number; visible: boolean; image?: string; columns?: number; rows?: number };
export const STAGE = { width: 1672, height: 941 };
export interface CameraState { x: number; y: number; zoom: number }
export function cameraBounds(width: number, height: number, zoom: number) {
  const scale = Math.max(width / STAGE.width, height / STAGE.height) * zoom;
  return { scale, maxX: Math.max(0, (STAGE.width - width / scale) / 2), maxY: Math.max(0, (STAGE.height - height / scale) / 2) };
}
export function constrainCamera(value: CameraState, width: number, height: number): CameraState {
  const zoom = Math.max(1, Math.min(2.5, value.zoom)), { maxX, maxY } = cameraBounds(width, height, zoom);
  return { zoom, x: Math.max(-maxX, Math.min(maxX, value.x)), y: Math.max(-maxY, Math.min(maxY, value.y)) };
}
export function placeFieldMarker(point: Point, viewport: { width: number; height: number }, label: { width: number; height: number }, occupied: Array<Point&{width:number;height:number}>=[]): Point | null {
  // Offscreen world anchors must not turn into overlapping edge buttons.
  const right = viewport.width - (viewport.width < 700 ? 70 : 110);
  if (point.x < 12 || point.x > right || point.y < 175 || point.y > viewport.height - 165) return null;
  const anchor={ x: Math.min(point.x, right - label.width), y: point.y - label.height / 2 };
  const offsets=[[0,0],[0,label.height+14],[0,-label.height-14],[-label.width-14,0],[label.width+14,0],[-label.width-14,label.height+14],[label.width+14,-label.height-14]];
  for(const [dx,dy] of offsets){const candidate={x:anchor.x+dx!,y:anchor.y+dy!};
    if(candidate.x<12||candidate.x+label.width>right||candidate.y<155||candidate.y+label.height>viewport.height-140)continue;
    if(occupied.every(other=>candidate.x+label.width+8<=other.x||candidate.x>=other.x+other.width+8||candidate.y+label.height+8<=other.y||candidate.y>=other.y+other.height+8))return candidate;
  }
  return null;
}
const nodeOrder = ["loc-oyster-alley-gate", "loc-community-courtyard", "loc-waterfront-service-point"];
const nodeNames: Record<string, string> = { "loc-oyster-alley-gate": "巷口", "loc-community-courtyard": "居民小院", "loc-waterfront-service-point": "资料联络点", "loc-zanhuawei-workshop": "簪花工坊", "loc-merchant-storefront": "沿街店铺", "loc-mobile-edit-bay": "移动编辑台", "loc-newsroom-desk": "编辑部" };
export function nodeName(node: FieldNode) { return nodeNames[node.sceneRef] ?? node.title; }
export function sceneImage(node: FieldVisualNode) { return node.environmentImage || (node.sceneRef === "loc-oyster-alley-gate" ? "/assets/node-world/alley.png" : ""); }
export function orderNodes(nodes: readonly FieldNode[]) { return [...nodes].sort((a, b) => (nodeOrder.includes(a.sceneRef) ? nodeOrder.indexOf(a.sceneRef) : 9) - (nodeOrder.includes(b.sceneRef) ? nodeOrder.indexOf(b.sceneRef) : 9)); }
export function sceneActors(node: FieldVisualNode): FieldActor[] {
  const appearances: Record<string, Omit<FieldActor, "visible">[]> = {
    "loc-oyster-alley-gate": [{ entityId: "entity-gatekeeper", x: .25, y: .85, height: .53, atlas: 0 }],
    "loc-community-courtyard": [{ entityId: "entity-community-source", x: .55, y: .94, height: .68, atlas: 1 }],
    "loc-waterfront-service-point": [{ entityId: "entity-researcher", x: .82, y: 1.03, height: .69, atlas: 2 }],
  };
  const configured = node.people.filter(person => person.appearance).map(person => {
    const value = person.appearance!;
    return { entityId: person.entityId, x: value.x, y: value.y, height: value.height, atlas: value.atlas?.index ?? 0,
      image: value.image, columns: value.atlas?.columns ?? 1, rows: value.atlas?.rows ?? 1,
      visible: person.presence.visible && person.status !== "left" && person.status !== "closed" };
  });
  return [...configured, ...(appearances[node.sceneRef] ?? []).filter(actor => !configured.some(value => value.entityId === actor.entityId)).flatMap(actor => {
    const person = node.people.find(p => p.entityId === actor.entityId);
    return person ? [{ ...actor, visible: person.presence.visible && person.status !== "left" && person.status !== "closed" }] : [];
  })];
}
export function objectPosition(node: FieldVisualNode, index: number): Point {
  if (node.sceneRef === "loc-oyster-alley-gate") return { x: .74 + (index % 2) * .07, y: .58 + Math.floor(index / 2) * .07 };
  if (node.sceneRef === "loc-community-courtyard") return { x: .2 + (index % 2) * .1, y: .54 + Math.floor(index / 2) * .1 };
  const preferred={ x: .70 + (index % 2) * .075, y: .44 + Math.floor(index / 2) * .075 };
  const covered=sceneActors(node).some(actor=>actor.visible&&Math.abs(preferred.x-actor.x)<.13&&Math.abs(preferred.y-(actor.y-actor.height*.6))<.2);
  return covered?{x:.16+(index%3)*.08,y:.48+Math.floor(index/3)*.09}:preferred;
}
