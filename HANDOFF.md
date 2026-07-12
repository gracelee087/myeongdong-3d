# Session Handoff — 여행영상 2종 제작(쇼츠+앨범) + 데모 폴리시 배치(팁 미디어/아바타 가시성/화살표) + 커밋·푸시

## Where it started
이전 핸드오프에서 Netlify 배포만 남은 상태로 시작. 사용자가 방향을 틀어 (1) 데모 사진으로 가족용 여행 영상 제작 (Gemini 생태계 필수), (2) 데모 직전 앱 폴리시 요청 연타(음식 팁 미디어, 아바타 가시성, 길 화살표, UI 버그)로 이어짐. 마감: DEV 챌린지 2026-07-13 06:59 UTC (15:59 KST). 사용자는 한국어, 응답도 한국어.

## Decisions locked + what shipped
- 여행영상 2종 완성: `C:\Users\honor\OneDrive\Desktop\mlhhackathon\myeongdong-trip.mp4` (48s 쇼츠, Veo 클립 2개 — 사용자 반응 별로) / `C:\Users\honor\OneDrive\Desktop\mlhhackathon\myeongdong-album.mp4` (65s 잔잔한 앨범 스타일 — 사용자 승인). 소스 프로젝트 `C:\Users\honor\OneDrive\Desktop\mlhhackathon\trip-shorts\` (HyperFrames). 스펙: `C:\Users\honor\OneDrive\Desktop\mlhhackathon\docs\superpowers\specs\2026-07-12-myeongdong-shorts-design.md`
- Veo 3.1 제약 발견: 실사 아동 포함 사진은 image-to-video 거절(과금 없음) — 비둘기 사진 대신 셀피로 대체. Veo 비용 ~$2.4, Lyria BGM $0.04/30s(항상 30s로 나옴 — ffmpeg acrossfade로 루프 연장), 앨범판 총 ~$0.25
- HyperFrames 렌더가 Windows에서 symlink EPERM으로 실패 → `C:\Users\honor\OneDrive\Desktop\mlhhackathon\trip-shorts\symlink-fallback.cjs` (프로세스 한정 fs.symlinkSync→cpSync 폴백). 렌더 명령: `NODE_OPTIONS="--require <절대경로>\symlink-fallback.cjs" node "C:\Users\honor\AppData\Local\npm-cache\_npx\4e526a225e857177\node_modules\hyperframes\dist\cli.js" render` (npm cache 직접 패치는 정책상 거부됨)
- 앱 폴리시 배치 커밋 `265624e` + GitHub 푸시 완료 (private 유지):
  - 사진 촬영 시 실시간 날씨 저장(entry.wx), 앨범에 시간·날씨·좌표 라벨(`#albumMeta`, sceneMeta/wxLabel in `js\main.js`), Gemini 앨범 프롬프트에 날씨 전달(`netlify\functions\album.js`)
  - 아바타/노란길 무조건 보임: 아바타 본래색 x-ray 패스(makeAvatar in `js\scene.js`, GreaterDepth opacity .96), 루트 x-ray 글로우, 솔리드 삼각형 방향 화살표 16m 간격(makeRoute) — 노치형 셰브론은 "xx"로 읽혀 교체됨. 건물 가라앉히기 시도는 사용자가 거부해 완전 삭제 (건물은 절대 건드리지 말 것)
  - 음식 팁 9개: 음식 사진(`img\food\`, Wikimedia 로컬 저장) + 인앱 "Watch preview"(video id 베이크) + 버튼 줄 [preview→save→maps, wrap 허용]; 간판 사진 제거; 2-cha 팁을 "ee-cha (round two)"로 재작성 — 이 팁만 오디오 미베이크(런타임 TTS 폴백 중)
  - 사이드바: `›` 접기 버그(이벤트 버블링) 수정, ⋯ 하나로 전 행 액션 열고닫기+상태 유지(state._actsOpen)
  - 청계천: 영상 42개 신규 베이크(116/116 전 스팟 영상 확보, 새탭 폴백 소멸) + 플로팅 이름표(labelCheonggyecheon)
  - POI 사진 공백 15곳 전부 채움 → 116개 전부 image+video+script 보유
- 신규 스크립트(전부 idempotent): `scripts\add-tip-food.mjs`(Wikimedia 429 → 재시도 내장), `scripts\tip-food-videos.mjs`, `scripts\fill-poi-images.mjs`
- 보이스: 사용자가 Jessica(cgSgspJ2msm6clMCkdW9) 선택 (Matilda보다 신남). 샘플 `voice-samples\`. ElevenLabs 잔여 ~12,181/30,003 (월간)
- 영상 산출물(trip-shorts/, voice-samples/, mp4 2종)은 .gitignore 처리 — 레포 미포함
- 로컬 폴더명(mlhhackathon)은 그대로 두기로 — 레포명은 이미 myeongdong-3d

## Key files for next session
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\js\main.js` — 팁 카드/앨범 메타/사이드바 로직 전부 이 파일
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\js\scene.js` — makeAvatar x-ray, makeRoute(화살표/x-ray), labelCheonggyecheon
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\data\local-tips.json` — tip.food {name,img,yt,video,videoTitle} 스키마
- `C:\Users\honor\OneDrive\Desktop\mlhhackathon\trip-shorts\index.html` — 앨범 영상 컴포지션 (v1 쇼츠판은 세션 scratchpad에 백업)
- Plan file: `C:\Users\honor\.claude\plans\wondrous-noodling-pebble.md` (구식 부분 있음 — 앱은 수제 Three.js)
- Memory files touched: none

## Running state
- Background processes: netlify dev (shell b4094damj) → http://localhost:8888 응답 확인됨. 종료: `npx kill-port 8888`
- Dev servers / ports: http://localhost:8888
- Open worktrees / branches: none (main, 푸시 완료, 클린)

## Verification — how to confirm things still work
- `node --check js/main.js && node --check js/scene.js` — 통과
- http://localhost:8888 하드리프레시 → 콘솔 에러 0
- 팁 카드: 음식 팁이면 음식 사진 + [Watch preview][Save for later][Google Maps] 한 줄
- Start Walk → 노란길 위 ▲ 화살표, 건물 뒤에서도 아바타 본래색으로 보임, 건물은 미동 없음
- 📷 촬영 → 토스트에 날씨 표기; Make my album → 캡션 밑에 `시간 · ☀️ 온도 · 📍좌표`
- `git log --oneline -1` → 265624e, origin/main과 동기화됨

## Deferred + open questions
- Deferred: Netlify 프로덕션 배포 — 여전히 `npx netlify login` 인터랙티브 로그인에 블록됨 (`!` 접두사로 실행 유도). 이후: 사이트 생성 → env 4종(ELEVENLABS_API_KEY, GEMINI_API_KEY, GOOGLE_MAPS_KEY, TOURAPI_KEY) → 배포 → /api/* 검증 → SUBMISSION.md에 LIVE_URL
- Deferred: README.md / SUBMISSION.md 갱신 — 이전 세션+이번 세션 기능 전부 미반영
- Deferred: DEV 포스트용 데모 영상/스크린샷 (마감 2026-07-13 15:59 KST); 제출 시 레포 public 전환 여부 확인
- Deferred: 오디오 리베이크 — 2-cha(ee-cha) 팁 텍스트 변경분 (현재 런타임 TTS 폴백으로 동작함)
- Open: "Menu Lens" 기능(Gemini vision) — 제안만 된 상태, 미승인
- Open: 앨범 영상 기능의 앱 내장화(export 버튼) — 사용자가 "지금 내 사진으로 하나만"을 택했고 이후 앱 메타데이터 기능으로 선회; 영상 export 내장은 논의 안 됨

## Pick up here
`! npx netlify login` 실행을 사용자에게 요청 → Netlify 배포 → README/SUBMISSION 갱신이 마감 전 최우선.
