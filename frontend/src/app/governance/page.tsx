import { GovernanceDashboard } from "@/components/governance/GovernanceDashboard";

export default function GovernancePage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">DAO Governance</h1>
        <p className="text-gray-600 mt-2">
          Participate in protocol governance and vote on proposals
        </p>
      </div>
      
      <GovernanceDashboard />
    </div>
  );
}
