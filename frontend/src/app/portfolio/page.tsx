import { PortfolioOverview } from "@/components/portfolio/PortfolioOverview";

export default function PortfolioPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Portfolio</h1>
        <p className="text-gray-600 mt-2">
          Monitor your positions, PnL, and trading performance
        </p>
      </div>
      
      <PortfolioOverview />
    </div>
  );
}
