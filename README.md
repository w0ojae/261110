# Lazy Day v52 GitHub Pages 배포용

현재 사이트의 v52 최적화 버전입니다. 별도 빌드나 OpenAI 설정 없이 배포할 수 있습니다.

1. ZIP 압축을 풉니다.
2. 이 README와 같은 위치의 index.html, assets, vendor, rain, weather, style 및 모든 JS/CSS 파일을 GitHub 저장소의 맨 위에 올립니다. 파일과 폴더의 이름과 구조를 유지하세요.
3. ZIP 파일 자체나 이를 감싸는 상위 폴더를 올리지 마세요. 저장소 첫 화면에서 index.html이 바로 보여야 합니다.
4. 저장소 Settings에서 Pages를 엽니다. Source는 Deploy from a branch, Branch는 main, 폴더는 /(root)로 고르고 Save합니다. 브랜치 이름이 main이 아니라면 업로드한 브랜치를 선택합니다.
5. Pages에 표시되는 https://사용자명.github.io/저장소명/ 주소를 엽니다. GitHub 소스 코드 주소와 웹페이지 주소는 다릅니다.

.nojekyll도 포함해 업로드하세요. 이 ZIP에는 .openai, .git, node_modules, 토큰, 호스팅 인증 파일이 없습니다.

모델, SUIT 폰트, Three.js, 비 효과와 라이선스 파일은 함께 들어 있습니다. 외부 유튜브 연결은 음악을 선택했을 때만 사용합니다. 영상별 외부 재생 제한과 브라우저 정책은 원래 사이트와 같습니다.

로컬에서 index.html을 더블클릭하는 대신 HTTP 서버로 열어야 합니다. 수정과 로컬 실행에는 별도로 제공한 source ZIP과 그 안의 README를 사용하세요.

GitHub 공식 안내:
https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
