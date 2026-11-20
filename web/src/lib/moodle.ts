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

const TOKEN_RE = /^[0-9a-f]{32}$/i;

/**
 * Reads a Moodle web service token from what the user pasted: the 32-hex token itself or the
 * moodlemobile://token=BASE64 launch link, whose base64 decodes to SIGNATURE:::TOKEN[:::PRIVATE].
 * Returns null for anything else and never throws.
 */
export function extract_moodle_token(input: string): string | null {
  const text = input.trim();
  if (TOKEN_RE.test(text)) return text;
  const match = /token=([A-Za-z0-9+/_=-]+)/.exec(text);
  if (!match) return null;
  try {
    const b64 = match[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const token = atob(b64).split(':::')[1]?.trim() ?? '';
    return TOKEN_RE.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** Moodle page that shows the mobile-app launch link holding the token (confirmed=1 skips the auto redirect). */
export function moodle_token_page_url(site: string): string | null {
  try {
    const url = new URL(site);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/admin/tool/mobile/launch.php`;
    url.search = `?service=moodle_mobile_app&passport=${Math.floor(Math.random() * 1e9)}&urlscheme=moodlemobile&confirmed=1`;
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
}

export interface BookmarkletText {
  /** Shown after the token is on the clipboard. */
  copied: string;
  /** Prompt label when the clipboard is blocked; the token is pre-selected in the prompt. */
  copy_manually: string;
  /** Shown when the page is not a signed-in Moodle or no token link was found. */
  not_found: string;
}

/**
 * Source of the "get token" bookmarklet. Run on a signed-in Moodle tab, it reads the app launch page
 * (same origin, confirmed=1), decodes SIGNATURE:::TOKEN and copies only TOKEN. It sends nothing anywhere.
 */
export function moodle_token_bookmarklet_source(text: BookmarkletText): string {
  const s = (v: string) => JSON.stringify(v);
  return `(async()=>{var no=${s(text.not_found)};try{` +
    `var root=((window.M&&M.cfg&&M.cfg.wwwroot)||location.origin).replace(/[/]+$/,'');` +
    `var url=root+'/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport='+Math.floor(Math.random()*1e9)+'&urlscheme=moodlemobile&confirmed=1';` +
    `var html=await (await fetch(url,{credentials:'same-origin'})).text();` +
    `var m=/moodlemobile:[/][/]token=([A-Za-z0-9+/=_-]+)/.exec(html);if(!m){alert(no);return;}` +
    `var tok=(atob(m[1].replace(/-/g,'+').replace(/_/g,'/')).split(':::')[1]||'').trim();` +
    `if(!/^[0-9a-f]{32}$/i.test(tok)){alert(no);return;}` +
    `try{await navigator.clipboard.writeText(tok);alert(${s(text.copied)});}catch(e){prompt(${s(text.copy_manually)},tok);}` +
    `}catch(e){alert(no);}})();`;
}

/** The bookmarklet as a javascript: URL for a draggable link. */
export function moodle_token_bookmarklet(text: BookmarkletText): string {
  return `javascript:${encodeURIComponent(moodle_token_bookmarklet_source(text))}`;
}
