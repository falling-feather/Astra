function hash(x, y, z) {
  let n = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
  n = Math.imul(n ^ n >>> 13, 1274126177);
  return (n ^ n >>> 16) >>> 0;
}

function noise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let tx = x - ix, ty = y - iy, tz = z - iz;
  tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty); tz = tz * tz * (3 - 2 * tz);
  const sample = (dx, dy, dz) => hash(ix + dx, iy + dy, iz + dz) / 4294967295;
  const mix = (a, b, t) => a + (b - a) * t;
  return mix(mix(mix(sample(0, 0, 0), sample(1, 0, 0), tx), mix(sample(0, 1, 0), sample(1, 1, 0), tx), ty),
    mix(mix(sample(0, 0, 1), sample(1, 0, 1), tx), mix(sample(0, 1, 1), sample(1, 1, 1), tx), ty), tz);
}

/** Bake a stationary three-dimensional cloud field. The artwork supplies color, never a sphere surface. */
export function buildNebulaDensity(image, size = 96) {
  const volume = new Uint8Array(size ** 3 * 4);
  for (let z = 0; z < size; z++) {
    const pz = z / (size - 1) * 2 - 1;
    for (let y = 0; y < size; y++) {
      const py = y / (size - 1) * 2 - 1;
      for (let x = 0; x < size; x++) {
        const px = x / (size - 1) * 2 - 1;
        const radius2 = px * px + py * py + pz * pz;
        if (radius2 >= .98) continue;
        const low = noise(px * 3.1 + 7, py * 3.1 + 5, pz * 3.1 + 9);
        const fine = noise(px * 12 + 1, py * 12 + 3, pz * 12 + 8);
        const warp = (low - .5) * pz * .18;
        const sx = Math.max(0, Math.min(image.width - 1, Math.round((.5 + px * .47 + warp) * (image.width - 1))));
        const sy = Math.max(0, Math.min(image.height - 1, Math.round((.5 - py * .47 - warp) * (image.height - 1))));
        const pixel = (sy * image.width + sx) * 4;
        const luminance = (image.data[pixel] * .2126 + image.data[pixel + 1] * .7152 + image.data[pixel + 2] * .0722) / 255;
        const radial = Math.sqrt(px * px + py * py);
        const fineDetail = noise(px * 27 + 4, py * 27 + 11, pz * 27 + 2);
        const spiral = Math.pow(.5 + .5 * Math.cos(Math.atan2(py, px) * 2 - Math.log(radial + .19) * 5.6 + (low - .5) * 1.3), 4);
        const bulge = Math.exp(-radial * radial * 32 - pz * pz * 48);
        const filaments = Math.pow(Math.max(0, (fine - .28) * 1.5), 1.35) * .7 + fineDetail * .3;
        const displacedZ = pz - (low - .5) * .1;
        const depth = Math.exp(-displacedZ * displacedZ / (.012 + low * .018));
        const edge = Math.min(1, (1 - radius2) * 3.8);
        const density = ((spiral * .62 + low * low * .2) * (.22 + filaments * .8) + bulge * .38 + luminance * .04) * depth * edge;
        const offset = ((z * size + y) * size + x) * 4;
        volume[offset] = Math.min(255, 34 + fineDetail * 16 + bulge * 145 + image.data[pixel] * .12);
        volume[offset + 1] = Math.min(255, 110 + fineDetail * 34 + bulge * 82 + image.data[pixel + 1] * .1);
        volume[offset + 2] = Math.min(255, 192 + fineDetail * 28 + bulge * 12 + image.data[pixel + 2] * .06);
        volume[offset + 3] = Math.min(255, Math.round(density * 235));
      }
    }
  }
  return volume;
}
