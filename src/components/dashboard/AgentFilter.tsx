interface AgentFilterProps {
  availableAgents: Array<{ agent_email: string; agent_full_name: string }>
  selectedAgents: string[]
  onSelectionChange: (agents: string[]) => void
}

export function AgentFilter({ availableAgents, selectedAgents, onSelectionChange }: AgentFilterProps) {
  return (
    <div className="relative inline-block">
      <label className="text-sm font-medium text-foreground mr-2">Agent:</label>
      <select
        multiple
        value={selectedAgents}
        onChange={(e) => {
          const selected = Array.from(e.target.selectedOptions, option => option.value)
          onSelectionChange(selected)
        }}
        className="px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring min-w-[200px]"
      >
        <option value="">All Agents</option>
        {availableAgents.map(agent => (
          <option key={agent.agent_email} value={agent.agent_email}>
            {agent.agent_full_name} ({agent.agent_email})
          </option>
        ))}
      </select>
      {selectedAgents.length > 0 && (
        <div className="mt-2 text-xs text-muted-foreground">
          {selectedAgents.length} agent(s) selected
        </div>
      )}
    </div>
  )
}
