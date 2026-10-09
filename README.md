# 🎧 moodlist

감성 캐릭터와 함께 나만의 플레이리스트를 만들고, **링크 하나로 공유**하는 인터랙티브 웹.
캐릭터 위 캔버스에 음악을 **글래스 카드**로 흩뿌리고, 드래그로 배치하고, 카드를 누르면
화면 안에서 바로 재생됩니다.

## ✨ 화면 구성
| 화면 | 역할 |
|---|---|
| Splash | 새로고침마다 앱 심볼이 떠오른 뒤 열리듯 커지며 일러스트로 전환 (클릭 불필요, 클릭 시 바로 진행) |
| Landing | 엎드린 캐릭터 일러스트 + 3D 오브젝트 공전 + 한 줄 카피 + 시작하기 |
| Onboarding | 유리 카드 3단계: 이름 → 캐릭터(6종 얼굴) → 제목. 이름·캐릭터는 기기에 저장(`moodlist_profile`) |
| Editor | 캐릭터 + 음악 카드 3D Orbit(앞·뒤로 지나감) · 프로필 팝오버(이름·캐릭터·공유 링크) |
| Preview · Share · Public | 공개 화면 미리보기 · 공유 완료 시트 · 방문자 화면 |

- **6종 캐릭터** — Reader · Listener · Dreamer · Poet · Sunshine · Midnight (번호 1~3은 기존 공유 링크와 호환)
- **멀티 플랫폼** — YouTube · Spotify · Apple Music · SoundCloud, 인라인 미니 플레이어
- **앱 아이덴티티** — 심볼은 파비콘 · 홈 화면 아이콘(PWA manifest) · 공유 미리보기(og-image)로 노출
- **링크 공유** — LZString 압축 URL, 서버 없음 · localStorage 초안 저장

## 📁 구조
```
index.html · style.css · app.js     구조 · 스타일 · 로직
manifest.webmanifest                 홈 화면 추가(앱처럼 실행)
icon-192/512.png · icon-maskable-512.png · apple-touch-icon.png · favicon-32.png · og-image.png
brand/       moodlist_symbol.png(앱 심볼 원본) · moodlist_wordmark(.png/.webp) · moodlist_icon-sheet.png
characters/  char_0N.webp(웹용 전신) · char_0N_face.webp(얼굴) · char_0N_<이름>_front/back/sheet.png(원본)
scenes/      moodlist_trio-room · moodlist_listener-desk (About 등)
icons/       3D 아이콘 16종 (icon-sheet에서 분리)
v1/ · 기존/   이전 버전 자산 · 코드 백업
```
> 저장소에는 사이트가 실제로 쓰는 웹용 파일만 올립니다. 원본 PNG(`_front/_back/_sheet`, brand·scenes 원본)와 `v1/` · `기존/` 백업은 로컬에만 보관합니다.

## 🚀 사용
`index.html`을 브라우저로 열면 끝. (로컬에서 Spotify/SoundCloud 썸네일·임베드 로딩은
http 서버 환경에서 가장 안정적입니다.)

## 🔗 공유 방식
편집 화면 → **공유 링크 생성** → 링크 복사. 링크에 캐릭터·닉네임·제목·노래(플랫폼·위치)가
압축되어 담기며, 별도 백엔드/DB 없이 링크만으로 재생 가능한 플레이리스트가 공유됩니다.
