import { Route, Routes } from 'react-router-dom'
import BrandHeader from '../components/BrandHeader'
import Home from '../pages/Home'
import Exploration from '../pages/Exploration'
import Clustering from '../pages/Clustering'
import DatasetPage from '../pages/DatasetPage'
import Training from '../pages/Training'
import Evaluation from '../pages/Evaluation'
import { HelpTipProvider } from '../components/HelpTip'

export default function App() {
  return (
    <HelpTipProvider>
      <div className="tn-shell">
        <BrandHeader />
        <main className="tn-main">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/exploration" element={<Exploration />} />
            <Route path="/clustering" element={<Clustering />} />
            <Route path="/dataset" element={<DatasetPage />} />
            <Route path="/training" element={<Training />} />
            <Route path="/evaluation" element={<Evaluation />} />
          </Routes>
        </main>
      </div>
    </HelpTipProvider>
  )
}
