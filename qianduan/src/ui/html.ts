export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

export function courseArt(color: string, secondary: string): string {
  const paths = Array.from({ length: 10 }, (_, row) => {
    const points = Array.from({ length: 80 }, (_, i) => {
      const x = 8 + i * 3.4;
      const y = 85 + Math.sin(i * .075 + row * .18) * (17 + row * 2.7) + (row - 5) * 5;
      return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
    }).join(' ');
    return `<path d="${points}" stroke="${color}" stroke-width="${row === 5 ? 1.6 : .6}" opacity="${row === 5 ? .9 : .22 + row * .025}"/>`;
  }).join('');
  return `<svg class="course-art" viewBox="0 0 288 164" role="img" aria-label="课程概念图"><rect width="288" height="164" fill="${secondary}" opacity=".2"/><g stroke="${color}" stroke-width=".5" opacity=".15">${Array.from({length: 8}, (_,i)=>`<path d="M${i*40} 0v164M0 ${i*26}h288"/>`).join('')}</g><g fill="none">${paths}</g><circle cx="172" cy="76" r="3" fill="${color}"/><circle cx="172" cy="76" r="8" fill="none" stroke="${color}" opacity=".3"/><path d="M26 24v119h239" stroke="${color}" opacity=".35" fill="none"/></svg>`;
}
