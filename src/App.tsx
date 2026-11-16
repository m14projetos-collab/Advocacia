import { lazy, Suspense, useState } from 'react';
import { PracticeAreaKey } from './data/office';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { PracticeAreas } from './components/PracticeAreas';
import { AboutLawyer } from './components/AboutLawyer';
import { IntakeForm } from './components/IntakeForm';
import { AssistantWidget } from './components/AssistantWidget';
import { Footer } from './components/Footer';

const CrmApp = lazy(() => import('./crm/CrmApp'));

export function App() {
  if (window.location.pathname === '/crm' || window.location.pathname.startsWith('/crm/')) {
    return <Suspense fallback={<p role="status">Carregando escritório…</p>}><CrmApp /></Suspense>;
  }
  return <PublicPortal />;
}

function PublicPortal() {
  const [selectedArea, setSelectedArea] = useState<PracticeAreaKey>('familia_sucessoes');

  return (
    <div className="min-h-screen bg-ivory text-obsidian">
      <Navbar />
      <main>
        <Hero />
        <PracticeAreas onSelectArea={setSelectedArea} />
        <AboutLawyer />
        <IntakeForm selectedArea={selectedArea} />
      </main>
      <Footer />
      <AssistantWidget onSelectArea={setSelectedArea} />
    </div>
  );
}

export default App;
