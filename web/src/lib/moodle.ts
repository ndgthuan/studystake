/** Metadata uses the quiz instance ID. Moodle view.php accepts it in q. */
export function moodle_quiz_url(site: string, instance_id: number): string | null {
  try {
    const url = new URL(site);
    if (url.protocol !== 'https:' || url.username || url.password ||
        !Number.isSafeInteger(instance_id) || instance_id <= 0) return null;
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/mod/quiz/view.php`;
    url.search = `?q=${instance_id}`;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}
