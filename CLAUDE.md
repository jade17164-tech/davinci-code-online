# 다빈치 코드 온라인

보드게임 **다빈치 코드**의 웹 구현. Firebase Realtime Database로 실시간 멀티플레이를 한다.

- 배포: GitHub Pages가 `main` 브랜치를 그대로 서빙한다 → https://jade17164-tech.github.io/davinci-code-online/
- `main`에 푸시하면 **곧바로 배포된다.** 큰 변경은 브랜치에서 작업하고 확인한 뒤 합칠 것.

## 파일

| 파일 | 역할 |
|---|---|
| `index.html` | 게임 전체 — UI, 규칙, Firebase, 로비, 채팅, 칭호. 단일 파일 |
| `board3d.js` | 3D 보드 렌더러. **규칙을 전혀 모른다** |
| `prototype/` | 실험용. 배포에 영향 없음 |
| `prototype.html` | 초기 CSS 3D 실험. `board3d.js`가 대체함 |

## 구조

`index.html`이 Firebase 데이터를 받아 화면 상태를 계산하고, 그리는 일만 `board3d.js`에 넘긴다.

```
Board3D.mount({ canvas, app, labels })
Board3D.update(state)
Board3D.onPick(fn)   // {type:'target',pi,idx} | {type:'slot',idx} | {type:'deck',color}
```

클릭은 렌더러가 처리하지 않고 기존 핸들러로 되돌아온다 — `guessOtherTile` / `insertTileAt` / `handleDrawTile`.
**규칙을 고칠 일이 있으면 `index.html`만 보면 된다.** 렌더러는 건드릴 필요가 없다.

## 조심할 것

### 지목 인덱스는 "화면에 늘어놓은 순서" 기준

`guessOtherTile(playerId, idx)`의 `idx`는 저장 순서가 아니라 **화면 순서**다. 그 순서는
`sortHandForDisplay()` 하나가 정한다. 3D 보드와 기존 DOM 보드가 반드시 같은 함수를 써야 하며,
어긋나면 **누른 것과 다른 타일이 지목된다.**

### 시작 타일 수는 `startTileCountFor()` 한 곳에서만

자동 분배는 5인 이상이면 3장, 그 아래는 4장. 예전에 이 규칙이 두 군데 적혀 있다가 한쪽이
인원수를 보지 않아 안내 문구가 어긋났다. 새로 계산하지 말고 이 함수를 쓸 것.

### CSS 3D에서 `preserve-3d`를 깨뜨리는 것들

`prototype.html`을 만들며 반복해서 밟은 함정이다. 3D 보드가 Three.js로 넘어가 지금은 덜
중요하지만, CSS 3D를 다시 쓸 일이 있으면:

- `opacity`나 `filter`를 **애니메이션하면** 스태킹 컨텍스트가 생겨 `preserve-3d`가 깨진다.
  6면 블록이 한 평면으로 납작하게 눌린다.
- 기울어진 면과 **같은 평면에 그림자**를 두면 z-파이팅으로 그림자가 면 위에 그려진다.
  `translateZ`로 떼어놓을 것.
- 면 색에 그라데이션을 주면, 자리가 돌아간 좌석에서 그 밝기 변화가 좌우 차이로 보여
  타일이 두 톤으로 갈라져 보인다.

### Firebase

- 웹 `apiKey`가 코드에 있는 것은 **정상**이다. 공개되도록 설계된 값이다.
- 실제 보호는 콘솔의 **보안 규칙**이 한다. `users/$uid` 쓰기는 본인만 가능하도록 되어 있다.
- 로그인은 아이디/비밀번호를 `아이디@davinci.local` 가짜 이메일로 바꿔 Firebase Auth에 넘긴다.
- 구글 로그인은 `file://`에서 동작하지 않는다. 페이지에 도메인이 없어 승인 도메인으로 인정되지 않는다.

## 확인하는 법

로컬 서버로 띄운다. **미리보기 창에서 파일을 직접 열면 안 된다** — 파일을 `data:` URL로
바꾸기 때문에 `board3d.js` 같은 상대경로 스크립트를 못 읽는다.

```bash
python -m http.server 8777
```

`prototype/board-preview.html`은 로그인도 서버도 없이 보드만 확인하는 용도다
(`board3d.js`를 파일 안에 넣어뒀다).

## 아직 확인 못 한 것

- **실제 방에서의 지목 인덱스.** 둘 이상이 있어야 검증된다. 3D로 바꾼 뒤 아직 못 봤다.
- 모바일 화면에서의 3D 보드.
