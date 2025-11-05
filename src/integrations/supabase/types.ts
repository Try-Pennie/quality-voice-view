export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.12 (cd3cf9e)"
  }
  public: {
    Tables: {
      agent_manager_mapping: {
        Row: {
          agent_email: string
          manager_email: string
        }
        Insert: {
          agent_email: string
          manager_email: string
        }
        Update: {
          agent_email?: string
          manager_email?: string
        }
        Relationships: []
      }
      beyond_call_recording_requests: {
        Row: {
          affiliate_lead_id: string | null
          call_number: number | null
          closed_date: string | null
          created_at: string
          created_date: string | null
          docusign_status: string | null
          eligible_balance: number | null
          id: number
          opportunity_name: string | null
          opportunity_owner: string | null
          recording_links: string | null
          sales_company: string | null
          stage: string | null
          substage: string | null
        }
        Insert: {
          affiliate_lead_id?: string | null
          call_number?: number | null
          closed_date?: string | null
          created_at?: string
          created_date?: string | null
          docusign_status?: string | null
          eligible_balance?: number | null
          id?: number
          opportunity_name?: string | null
          opportunity_owner?: string | null
          recording_links?: string | null
          sales_company?: string | null
          stage?: string | null
          substage?: string | null
        }
        Update: {
          affiliate_lead_id?: string | null
          call_number?: number | null
          closed_date?: string | null
          created_at?: string
          created_date?: string | null
          docusign_status?: string | null
          eligible_balance?: number | null
          id?: number
          opportunity_name?: string | null
          opportunity_owner?: string | null
          recording_links?: string | null
          sales_company?: string | null
          stage?: string | null
          substage?: string | null
        }
        Relationships: []
      }
      eavesly_api_logs: {
        Row: {
          correlation_id: string
          created_at: string
          endpoint: string
          error_message: string | null
          http_method: string
          http_status_code: number
          id: number
          processing_time_ms: number
          request_timestamp: string
        }
        Insert: {
          correlation_id: string
          created_at?: string
          endpoint: string
          error_message?: string | null
          http_method?: string
          http_status_code: number
          id?: number
          processing_time_ms: number
          request_timestamp?: string
        }
        Update: {
          correlation_id?: string
          created_at?: string
          endpoint?: string
          error_message?: string | null
          http_method?: string
          http_status_code?: number
          id?: number
          processing_time_ms?: number
          request_timestamp?: string
        }
        Relationships: []
      }
      eavesly_calls: {
        Row: {
          agent_email: string | null
          agent_full_name: string | null
          call_id: string
          campaign_id: number | null
          campaign_name: string | null
          completed_at: string | null
          contact_phone: string | null
          conversation_happened: boolean | null
          created_at: string
          direction: string | null
          disposition: string | null
          ended_at: string | null
          handle_time: number | null
          id: number
          notes: string | null
          regal_voice_phone: string | null
          regal_voice_phone_internal_name: string | null
          sfdc_lead_id: string | null
          started_at: string | null
          talk_time: number | null
          type: string | null
          wrapup_time: number | null
        }
        Insert: {
          agent_email?: string | null
          agent_full_name?: string | null
          call_id: string
          campaign_id?: number | null
          campaign_name?: string | null
          completed_at?: string | null
          contact_phone?: string | null
          conversation_happened?: boolean | null
          created_at: string
          direction?: string | null
          disposition?: string | null
          ended_at?: string | null
          handle_time?: number | null
          id?: number
          notes?: string | null
          regal_voice_phone?: string | null
          regal_voice_phone_internal_name?: string | null
          sfdc_lead_id?: string | null
          started_at?: string | null
          talk_time?: number | null
          type?: string | null
          wrapup_time?: number | null
        }
        Update: {
          agent_email?: string | null
          agent_full_name?: string | null
          call_id?: string
          campaign_id?: number | null
          campaign_name?: string | null
          completed_at?: string | null
          contact_phone?: string | null
          conversation_happened?: boolean | null
          created_at?: string
          direction?: string | null
          disposition?: string | null
          ended_at?: string | null
          handle_time?: number | null
          id?: number
          notes?: string | null
          regal_voice_phone?: string | null
          regal_voice_phone_internal_name?: string | null
          sfdc_lead_id?: string | null
          started_at?: string | null
          talk_time?: number | null
          type?: string | null
          wrapup_time?: number | null
        }
        Relationships: []
      }
      eavesly_evaluation_results: {
        Row: {
          agent_id: string
          api_evaluation_timestamp: string
          api_overall_score: number
          call_id: string
          classification_result: Json
          communication_result: Json
          compliance_result: Json
          correlation_id: string
          created_at: string
          deep_dive_result: Json | null
          evaluation_version: string
          id: number
          processing_time_ms: number
          script_deviation_result: Json
          updated_at: string
        }
        Insert: {
          agent_id: string
          api_evaluation_timestamp: string
          api_overall_score: number
          call_id: string
          classification_result: Json
          communication_result: Json
          compliance_result: Json
          correlation_id: string
          created_at?: string
          deep_dive_result?: Json | null
          evaluation_version?: string
          id?: number
          processing_time_ms: number
          script_deviation_result: Json
          updated_at?: string
        }
        Update: {
          agent_id?: string
          api_evaluation_timestamp?: string
          api_overall_score?: number
          call_id?: string
          classification_result?: Json
          communication_result?: Json
          compliance_result?: Json
          correlation_id?: string
          created_at?: string
          deep_dive_result?: Json | null
          evaluation_version?: string
          id?: number
          processing_time_ms?: number
          script_deviation_result?: Json
          updated_at?: string
        }
        Relationships: []
      }
      eavesly_transcription_qa: {
        Row: {
          agent_email: string | null
          call_id: string | null
          call_summary: string | null
          coaching_insights_analysis: string | null
          compliance_rating: string | null
          created_at: string
          customer_satisfaction_likely: string | null
          id: number
          manager_email: string | null
          manager_escalation: boolean | null
          original_transcript: string | null
          overall_score: string | null
          qa_json: Json | null
          recording_link: string | null
          sfdc_lead_id: string | null
          transcription_link: string | null
        }
        Insert: {
          agent_email?: string | null
          call_id?: string | null
          call_summary?: string | null
          coaching_insights_analysis?: string | null
          compliance_rating?: string | null
          created_at?: string
          customer_satisfaction_likely?: string | null
          id?: number
          manager_email?: string | null
          manager_escalation?: boolean | null
          original_transcript?: string | null
          overall_score?: string | null
          qa_json?: Json | null
          recording_link?: string | null
          sfdc_lead_id?: string | null
          transcription_link?: string | null
        }
        Update: {
          agent_email?: string | null
          call_id?: string | null
          call_summary?: string | null
          coaching_insights_analysis?: string | null
          compliance_rating?: string | null
          created_at?: string
          customer_satisfaction_likely?: string | null
          id?: number
          manager_email?: string | null
          manager_escalation?: boolean | null
          original_transcript?: string | null
          overall_score?: string | null
          qa_json?: Json | null
          recording_link?: string | null
          sfdc_lead_id?: string | null
          transcription_link?: string | null
        }
        Relationships: []
      }
      eavesly_transcriptions: {
        Row: {
          call_id: string | null
          channels: number | null
          created_at: string
          duration_seconds: number | null
          full_transcript: string | null
          id: number
          key_moments: Json | null
          overall_sentiment: string | null
          overall_sentiment_score: number | null
          request_id: string | null
          speaker_count: number | null
          speaker_metrics: Json | null
          summary: string | null
          total_utterances: number | null
          utterances: Json | null
        }
        Insert: {
          call_id?: string | null
          channels?: number | null
          created_at?: string
          duration_seconds?: number | null
          full_transcript?: string | null
          id?: number
          key_moments?: Json | null
          overall_sentiment?: string | null
          overall_sentiment_score?: number | null
          request_id?: string | null
          speaker_count?: number | null
          speaker_metrics?: Json | null
          summary?: string | null
          total_utterances?: number | null
          utterances?: Json | null
        }
        Update: {
          call_id?: string | null
          channels?: number | null
          created_at?: string
          duration_seconds?: number | null
          full_transcript?: string | null
          id?: number
          key_moments?: Json | null
          overall_sentiment?: string | null
          overall_sentiment_score?: number | null
          request_id?: string | null
          speaker_count?: number | null
          speaker_metrics?: Json | null
          summary?: string | null
          total_utterances?: number | null
          utterances?: Json | null
        }
        Relationships: []
      }
      manager_coaching_prompts: {
        Row: {
          coaching_prompt: string
          created_at: string | null
          has_customized: boolean | null
          id: string
          manager_email: string
          shown_default_warning: boolean | null
          updated_at: string | null
        }
        Insert: {
          coaching_prompt: string
          created_at?: string | null
          has_customized?: boolean | null
          id?: string
          manager_email: string
          shown_default_warning?: boolean | null
          updated_at?: string | null
        }
        Update: {
          coaching_prompt?: string
          created_at?: string | null
          has_customized?: boolean | null
          id?: string
          manager_email?: string
          shown_default_warning?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      time_off_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          employee_email: string | null
          id: number
          request_id: string | null
          request_json: Json | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_email?: string | null
          id?: number
          request_id?: string | null
          request_json?: Json | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          employee_email?: string | null
          id?: number
          request_id?: string | null
          request_json?: Json | null
        }
        Relationships: []
      }
    }
    Views: {
      eavesly_transcription_qa_with_calls: {
        Row: {
          agent_email: string | null
          call_id: string | null
          call_summary: string | null
          coaching_insights_analysis: string | null
          compliance_rating: string | null
          contact_phone: string | null
          created_at: string | null
          customer_satisfaction_likely: string | null
          disposition: string | null
          handle_time: number | null
          id: number | null
          manager_email: string | null
          manager_escalation: boolean | null
          original_transcript: string | null
          overall_score: string | null
          qa_json: Json | null
          recording_link: string | null
          sfdc_lead_id: string | null
          talk_time: number | null
          transcription_link: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      check_call_completed: { Args: { call_id: string }; Returns: Json }
      check_transcription_completed: {
        Args: { call_id: string }
        Returns: Json
      }
      eavesly_call_data: { Args: { call_id: string }; Returns: Json }
      get_lead_profile_recap_agent_view: {
        Args: { p_sfdc_lead_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
