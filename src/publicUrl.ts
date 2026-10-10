/**
 * public/ 폴더 파일의 주소.
 * GitHub Pages 처럼 하위 경로(/museum-constructor/)에 배포돼도 열리도록 빌드 base 를 붙인다.
 */
export const publicUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
