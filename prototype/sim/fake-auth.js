// 시뮬레이터용 가짜 로그인. 창마다 정해진 계정으로 바로 로그인된 것처럼 군다.
export function getAuth() { return {}; }
export function onAuthStateChanged(auth, cb) {
  setTimeout(() => cb({ uid: window.__cfg.uid, providerData: [{ providerId: 'password' }] }), 0);
  return () => {};
}
const never = () => new Promise(() => {});
export const createUserWithEmailAndPassword = never;
export const signInWithEmailAndPassword = never;
export const signInWithPopup = never;
export const signInWithRedirect = never;
export const signOut = () => Promise.resolve();
export const getRedirectResult = () => Promise.resolve(null);
export class GoogleAuthProvider {}
