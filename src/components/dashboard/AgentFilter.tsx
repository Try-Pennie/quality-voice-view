interface AgentFilterProps {
  availableAgents: Array<{ agent_email: string; agent_full_name: string }>
  selectedAgents: string[]
  onSelectionChange: (agents: string[]) => void
}

export function AgentFilter({ availableAgents, selectedAgents, onSelectionChange }: AgentFilterProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    
    // If "All Agents" is selected, clear the filter
    if (value === "") {
      onSelectionChange([])
      return
    }
    
    // Otherwise, toggle the agent in the selection
    if (selectedAgents.includes(value)) {
      onSelectionChange(selectedAgents.filter(a => a !== value))
    } else {
      onSelectionChange([...selectedAgents, value])
    }
  }

  return (
    <div className="relative inline-block">
      <label className="text-sm font-medium text-foreground mr-2">Agent:</label>
      <select
        value={selectedAgents.length === 0 ? "" : selectedAgents[0]}
        onChange={handleChange}
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
        <div className="mt-2 flex flex-wrap gap-1">
          {selectedAgents.map(email => {
            const agent = availableAgents.find(a => a.agent_email === email)
            return (
              <span
                key={email}
                className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary text-xs rounded"
              >
                {agent?.agent_full_name || email}
                <button
                  onClick={() => onSelectionChange(selectedAgents.filter(a => a !== email))}
                  className="hover:text-primary/80"
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
