import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import './styles.css';
const ContentApp=React.lazy(()=>import('./content/ContentApp').then(m=>({default:m.ContentApp})));

let notifyUpdate: (() => void) | undefined;
let pendingUpdate = false;
const activateUpdate = registerSW({ onNeedRefresh() { pendingUpdate = true; notifyUpdate?.(); } });
// Registering the worker never reloads the page while a form is being edited.
class StorageBoundary extends React.Component<{ children: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    return this.state.error ? <main className="main"><h1>여행 저장소를 열 수 없습니다</h1><p>이 브라우저에서 IndexedDB를 사용할 수 있는지 확인한 뒤 다시 열어 주세요. 저장된 데이터를 삭제하지 않았습니다.</p><button onClick={() => location.reload()}>다시 열기</button></main> : this.props.children;
  }
}
function AppShell() {
  const [update, setUpdate] = useState(pendingUpdate);
  React.useEffect(() => { notifyUpdate = () => setUpdate(true); return () => { notifyUpdate = undefined; }; }, []);
  return <><nav className="workspace-nav" aria-label="저장소 화면"><a href="?workspace=content">여행 가이드 열기</a><a href="?workspace=legacy">기존 일정 열기</a></nav>{new URLSearchParams(location.search).get('workspace')==='content'?<React.Suspense fallback={<main className="main">가이드를 여는 중입니다.</main>}><ContentApp/></React.Suspense>:<App />}{update ? <div className="update-bar" role="status"><span>새 버전이 준비됐습니다. 입력을 저장한 뒤 적용하세요.</span><button onClick={() => void activateUpdate(true)}>저장 후 새 버전 열기</button></div> : null}</>;
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><StorageBoundary><AppShell /></StorageBoundary></React.StrictMode>);
