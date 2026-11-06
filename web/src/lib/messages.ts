// Signed message builders. Must match oracle/src/link.ts and oracle/src/index.ts byte for byte.

/** Message the wallet signs to link an LMS account (oracle POST /link). */
export function link_message(wallet: string, lms: string, site: string, issued_at: number): string {
  return `StudyStake link\nwallet: ${wallet.toLowerCase()}\nlms: ${lms}\nsite: ${site}\nissued_at: ${issued_at}`;
}

/** Message the wallet signs to unlink (oracle DELETE /link). */
export function unlink_message(wallet: string, issued_at: number): string {
  return `StudyStake unlink\nwallet: ${wallet.toLowerCase()}\nissued_at: ${issued_at}`;
}

/** Message the wallet signs to opt in or out of selling the credential (oracle POST /x402/credential/consent). */
export function consent_message(wallet: string, share: boolean, issued_at: number): string {
  return `StudyStake credential consent\nwallet: ${wallet.toLowerCase()}\nshare: ${share}\nissued_at: ${issued_at}`;
}

/** Message the wallet signs for a demo submission (oracle POST /demo/submit). */
export function demo_submit_message(wallet: string, challenge_id: number, instance_id: number, issued_at: number): string {
  return `StudyStake demo submit\nwallet: ${wallet.toLowerCase()}\nchallenge: ${challenge_id}\ninstance: ${instance_id}\nissued_at: ${issued_at}`;
}

/** Message the creator wallet signs to upload challenge metadata (oracle POST /metadata). */
export function metadata_message(wallet: string, hash: string, issued_at: number): string {
  return `StudyStake metadata\nwallet: ${wallet.toLowerCase()}\nhash: ${hash}\nissued_at: ${issued_at}`;
}
