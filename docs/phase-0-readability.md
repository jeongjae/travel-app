# Phase 0 코드 가독성 확인 자료

2026-10-22 · G0 사용자 확인 대기

기준 커밋 `54d7959`의 코드와 현재 코드를 비교한다. 의미 있는 이름·책임 분리는 이번 포맷에 섞지 않았다. 아래 표본과 실제 파일을 읽고, 이후 유지보수에 충분한지 확인한다. 확인 전 Phase 1에 진입하지 않는다.

| 파일 | 줄 수 전 → 후 | 최장 줄 전 → 후 |
|---|---:|---:|
| `src/content/ContentApp.tsx` | 71 → 1133 | 2064 → 187 |
| `src/storage/content-repository.ts` | 257 → 1087 | 765 → 120 |
| `src/transfer/spfr-candidate.ts` | 81 → 494 | 668 → 116 |

줄 수 증가는 기능 추가 수치가 아니라 압축된 문장을 펼친 결과다. 120자는 Prettier의 줄 길이 목표다. 줄바꿈이 의미를 바꿀 수 있는 긴 JSX 본문·문자열·URL은 예외이며, 사람이 작성하는 제어 흐름을 이 예외로 압축하지 않는다. [Prettier 설명](https://prettier.io/docs/options#print-width).

## 화면 작업의 오류·busy 상태 처리

[실제 파일](../src/content/ContentApp.tsx)

적용 전:

```ts
async function action(fn:()=>Promise<unknown>,message='저장했습니다.'){setError('');setBusy(true);try{await fn();setNotice(message);}catch(e){setError(errorText(e));}finally{setBusy(false);}}
```

적용 후:

```ts
async function action(fn: () => Promise<unknown>, message = '저장했습니다.') {
  setError('');
  setBusy(true);
  try {
    await fn();
    setNotice(message);
  } catch (e) {
    setError(errorText(e));
  } finally {
    setBusy(false);
  }
}
```

## 저장 조건을 명시적으로 검사하는 함수

[실제 파일](../src/storage/content-repository.ts)

적용 전:

```ts
function must(ok: unknown, code: string, message: string): asserts ok { if (!ok) throw new RepositoryError(code, message); }
```

적용 후:

```ts
function must(ok: unknown, code: string, message: string): asserts ok {
  if (!ok) {
    throw new RepositoryError(code, message);
  }
}
```

## 원천 누락·미해결 입력을 차단하는 함수

[실제 파일](../src/transfer/spfr-candidate.ts)

적용 전:

```ts
const entry=(path:string)=>{const e=extract.entries.find(e=>e.sourceKey===path);if(!e||e.status!=='extracted')throw new Error(`원천 누락/미해결: ${path}`);return e;};
```

적용 후:

```ts
const entry = (path: string) => {
    const e = extract.entries.find((e) => e.sourceKey === path);
    if (!e || e.status !== 'extracted') {
      throw new Error(`원천 누락/미해결: ${path}`);
    }
    return e;
  };
```

## 확인할 내용

- 오류 처리·분기·반환·JSX 계층을 줄 단위로 따라갈 수 있는가.
- 대표 파일의 다른 부분도 같은 방식으로 읽을 수 있는가.
- 추가 책임 분리나 이름 개선이 필요하면 해당 파일·함수를 지정한다. 테스트 통과만으로 가독성 확인을 대신하지 않는다.

현재 상태는 **확인 대기**다. 사용자의 실제 응답을 받은 뒤 [Phase 0 보고](phase-0-report.md)에 기록한다.
