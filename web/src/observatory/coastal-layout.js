import { layerPoint, REFERENCE_FRAME } from './layers.js';
import { sceneFrame, projectPoint } from './motion.js';

/** The foreground depends only on the window, never on the draggable sky camera. */
export function coastalLayout(width, height, layers) {
  const frame = sceneFrame(width, height);
  const project = point => projectPoint(point.x / REFERENCE_FRAME.width, point.y / REFERENCE_FRAME.height, frame, width, height);
  const seaLine = layerPoint(layers.find(layer => layer.id === 'ocean'), 'waterline');
  const waterline = project(seaLine).y;
  const skyHeight = Math.min(height, Math.ceil(project({ ...seaLine, y: seaLine.y + REFERENCE_FRAME.height * .008 }).y));
  const telescope = layers.find(layer => layer.id === 'telescope');
  const lens = project(layerPoint(telescope, 'lens')), eyepiece = project(layerPoint(telescope, 'eyepiece'));
  return {
    frame, waterline,
    sky: { width, height: skyHeight },
    coast: { width, height },
    telescope: {
      x: (lens.x + eyepiece.x) / 2, y: (lens.y + eyepiece.y) / 2,
      width: Math.max(84, Math.abs(lens.x - eyepiece.x) + 40),
      height: Math.max(66, Math.abs(lens.y - eyepiece.y) + 42),
    },
  };
}
