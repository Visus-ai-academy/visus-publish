export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: { Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json }; Returns: Json };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      account_insights_daily: {
        Row: {
          day: string;
          follower_count: number | null;
          ig_account_id: string;
          profile_views: number | null;
          raw: Json | null;
          reach: number | null;
          tenant_id: string;
          views: number | null;
        };
        ComputedFields: never;
        Insert: {
          day: string;
          follower_count?: number | null;
          ig_account_id: string;
          profile_views?: number | null;
          raw?: Json | null;
          reach?: number | null;
          tenant_id: string;
          views?: number | null;
        };
        Update: {
          day?: string;
          follower_count?: number | null;
          ig_account_id?: string;
          profile_views?: number | null;
          raw?: Json | null;
          reach?: number | null;
          tenant_id?: string;
          views?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "account_insights_daily_ig_account_same_tenant";
            columns: ["ig_account_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "ig_accounts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "account_insights_daily_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_credentials: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          provider: string;
          secret_id: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          provider: string;
          secret_id: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          provider?: string;
          secret_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_credentials_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_models: {
        Row: {
          active: boolean;
          id: string;
          model: string;
          provider: string;
          task: Database["public"]["Enums"]["ai_task"];
          unit_cost_credits: number;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          id: string;
          model: string;
          provider: string;
          task: Database["public"]["Enums"]["ai_task"];
          unit_cost_credits?: number;
        };
        Update: {
          active?: boolean;
          id?: string;
          model?: string;
          provider?: string;
          task?: Database["public"]["Enums"]["ai_task"];
          unit_cost_credits?: number;
        };
        Relationships: [];
      };
      ai_platform_keys: {
        Row: {
          provider: string;
          secret_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          provider: string;
          secret_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          provider?: string;
          secret_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      ai_settings: {
        Row: {
          billing_mode: Database["public"]["Enums"]["billing_mode"];
          default_caption_provider: string;
          default_image_provider: string;
          default_video_provider: string;
          tenant_id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          billing_mode?: Database["public"]["Enums"]["billing_mode"];
          default_caption_provider?: string;
          default_image_provider?: string;
          default_video_provider?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          billing_mode?: Database["public"]["Enums"]["billing_mode"];
          default_caption_provider?: string;
          default_image_provider?: string;
          default_video_provider?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_settings_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      analysis_findings: {
        Row: {
          action: Json | null;
          applied_at: string | null;
          applied_by: string | null;
          body: string;
          created_at: string;
          evidence: Json | null;
          id: string;
          ig_account_id: string | null;
          period_end: string;
          period_start: string;
          tenant_id: string;
          title: string;
        };
        ComputedFields: never;
        Insert: {
          action?: Json | null;
          applied_at?: string | null;
          applied_by?: string | null;
          body: string;
          created_at?: string;
          evidence?: Json | null;
          id?: string;
          ig_account_id?: string | null;
          period_end: string;
          period_start: string;
          tenant_id: string;
          title: string;
        };
        Update: {
          action?: Json | null;
          applied_at?: string | null;
          applied_by?: string | null;
          body?: string;
          created_at?: string;
          evidence?: Json | null;
          id?: string;
          ig_account_id?: string | null;
          period_end?: string;
          period_start?: string;
          tenant_id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "analysis_findings_ig_account_same_tenant";
            columns: ["ig_account_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "ig_accounts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "analysis_findings_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      audience_snapshots: {
        Row: {
          age: Json | null;
          cities: Json | null;
          collected_at: string;
          gender: Json | null;
          id: number;
          ig_account_id: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          age?: Json | null;
          cities?: Json | null;
          collected_at?: string;
          gender?: Json | null;
          id?: number;
          ig_account_id: string;
          tenant_id: string;
        };
        Update: {
          age?: Json | null;
          cities?: Json | null;
          collected_at?: string;
          gender?: Json | null;
          id?: number;
          ig_account_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audience_snapshots_ig_account_same_tenant";
            columns: ["ig_account_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "ig_accounts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "audience_snapshots_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          actor: string | null;
          created_at: string;
          id: number;
          meta: Json | null;
          target: string | null;
          tenant_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor?: string | null;
          created_at?: string;
          id?: number;
          meta?: Json | null;
          target?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          action?: string;
          actor?: string | null;
          created_at?: string;
          id?: number;
          meta?: Json | null;
          target?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      brand_profiles: {
        Row: {
          audience: string | null;
          colors: string[];
          default_hashtags: string[];
          fonts: string[];
          forbidden_topics: string | null;
          ig_account_id: string;
          is_healthcare: boolean;
          logo_path: string | null;
          tenant_id: string;
          tone: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          audience?: string | null;
          colors?: string[];
          default_hashtags?: string[];
          fonts?: string[];
          forbidden_topics?: string | null;
          ig_account_id: string;
          is_healthcare?: boolean;
          logo_path?: string | null;
          tenant_id: string;
          tone?: string | null;
          updated_at?: string;
        };
        Update: {
          audience?: string | null;
          colors?: string[];
          default_hashtags?: string[];
          fonts?: string[];
          forbidden_topics?: string | null;
          ig_account_id?: string;
          is_healthcare?: boolean;
          logo_path?: string | null;
          tenant_id?: string;
          tone?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "brand_profiles_ig_account_same_tenant";
            columns: ["ig_account_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "ig_accounts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "brand_profiles_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      credit_ledger: {
        Row: {
          created_at: string;
          delta: number;
          generation_job_id: string | null;
          id: number;
          reason: string;
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          delta: number;
          generation_job_id?: string | null;
          id?: number;
          reason: string;
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          delta?: number;
          generation_job_id?: string | null;
          id?: number;
          reason?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "credit_ledger_job_same_tenant";
            columns: ["generation_job_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "generation_jobs";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "credit_ledger_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      generation_jobs: {
        Row: {
          created_at: string;
          credits: number | null;
          error: string | null;
          external_id: string | null;
          finished_at: string | null;
          id: string;
          model: string | null;
          post_id: string | null;
          provider: string;
          request: Json | null;
          result: Json | null;
          status: Database["public"]["Enums"]["job_status"];
          task: Database["public"]["Enums"]["ai_task"];
          tenant_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          credits?: number | null;
          error?: string | null;
          external_id?: string | null;
          finished_at?: string | null;
          id?: string;
          model?: string | null;
          post_id?: string | null;
          provider: string;
          request?: Json | null;
          result?: Json | null;
          status?: Database["public"]["Enums"]["job_status"];
          task: Database["public"]["Enums"]["ai_task"];
          tenant_id: string;
        };
        Update: {
          created_at?: string;
          credits?: number | null;
          error?: string | null;
          external_id?: string | null;
          finished_at?: string | null;
          id?: string;
          model?: string | null;
          post_id?: string | null;
          provider?: string;
          request?: Json | null;
          result?: Json | null;
          status?: Database["public"]["Enums"]["job_status"];
          task?: Database["public"]["Enums"]["ai_task"];
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "generation_jobs_post_same_tenant";
            columns: ["post_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "generation_jobs_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      ig_accounts: {
        Row: {
          account_type: string | null;
          color: string;
          connected_by: string | null;
          created_at: string;
          id: string;
          ig_user_id: string;
          metricool_blog_id: string | null;
          name: string | null;
          profile_picture_url: string | null;
          publish_via: Database["public"]["Enums"]["publish_provider"];
          require_approval: boolean;
          status: Database["public"]["Enums"]["ig_account_status"];
          tenant_id: string;
          token_expires_at: string | null;
          token_secret_id: string | null;
          username: string;
        };
        ComputedFields: never;
        Insert: {
          account_type?: string | null;
          color?: string;
          connected_by?: string | null;
          created_at?: string;
          id?: string;
          ig_user_id: string;
          metricool_blog_id?: string | null;
          name?: string | null;
          profile_picture_url?: string | null;
          publish_via?: Database["public"]["Enums"]["publish_provider"];
          require_approval?: boolean;
          status?: Database["public"]["Enums"]["ig_account_status"];
          tenant_id: string;
          token_expires_at?: string | null;
          token_secret_id?: string | null;
          username: string;
        };
        Update: {
          account_type?: string | null;
          color?: string;
          connected_by?: string | null;
          created_at?: string;
          id?: string;
          ig_user_id?: string;
          metricool_blog_id?: string | null;
          name?: string | null;
          profile_picture_url?: string | null;
          publish_via?: Database["public"]["Enums"]["publish_provider"];
          require_approval?: boolean;
          status?: Database["public"]["Enums"]["ig_account_status"];
          tenant_id?: string;
          token_expires_at?: string | null;
          token_secret_id?: string | null;
          username?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ig_accounts_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          role: Database["public"]["Enums"]["member_role"];
          tenant_id: string;
          token_hash: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role?: Database["public"]["Enums"]["member_role"];
          tenant_id: string;
          token_hash: string;
        };
        Update: {
          accepted_at?: string | null;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role?: Database["public"]["Enums"]["member_role"];
          tenant_id?: string;
          token_hash?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      media_insights: {
        Row: {
          collected_at: string;
          comments: number | null;
          follows: number | null;
          id: number;
          likes: number | null;
          post_id: string;
          profile_visits: number | null;
          raw: Json | null;
          reach: number | null;
          saved: number | null;
          shares: number | null;
          snapshot: string;
          tenant_id: string;
          total_interactions: number | null;
          views: number | null;
        };
        ComputedFields: never;
        Insert: {
          collected_at?: string;
          comments?: number | null;
          follows?: number | null;
          id?: number;
          likes?: number | null;
          post_id: string;
          profile_visits?: number | null;
          raw?: Json | null;
          reach?: number | null;
          saved?: number | null;
          shares?: number | null;
          snapshot: string;
          tenant_id: string;
          total_interactions?: number | null;
          views?: number | null;
        };
        Update: {
          collected_at?: string;
          comments?: number | null;
          follows?: number | null;
          id?: number;
          likes?: number | null;
          post_id?: string;
          profile_visits?: number | null;
          raw?: Json | null;
          reach?: number | null;
          saved?: number | null;
          shares?: number | null;
          snapshot?: string;
          tenant_id?: string;
          total_interactions?: number | null;
          views?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "media_insights_post_same_tenant";
            columns: ["post_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "media_insights_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      memberships: {
        Row: {
          created_at: string;
          role: Database["public"]["Enums"]["member_role"];
          tenant_id: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          role?: Database["public"]["Enums"]["member_role"];
          tenant_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          role?: Database["public"]["Enums"]["member_role"];
          tenant_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "memberships_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      metricool_connections: {
        Row: {
          access_expires_at: string | null;
          auth_mode: string;
          connected_by: string | null;
          created_at: string;
          mcp_tools: Json | null;
          metricool_user_id: string | null;
          oauth_client_id: string | null;
          oauth_client_secret_id: string | null;
          refresh_secret_id: string | null;
          tenant_id: string;
          token_secret_id: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          access_expires_at?: string | null;
          auth_mode?: string;
          connected_by?: string | null;
          created_at?: string;
          mcp_tools?: Json | null;
          metricool_user_id?: string | null;
          oauth_client_id?: string | null;
          oauth_client_secret_id?: string | null;
          refresh_secret_id?: string | null;
          tenant_id: string;
          token_secret_id?: string | null;
          updated_at?: string;
        };
        Update: {
          access_expires_at?: string | null;
          auth_mode?: string;
          connected_by?: string | null;
          created_at?: string;
          mcp_tools?: Json | null;
          metricool_user_id?: string | null;
          oauth_client_id?: string | null;
          oauth_client_secret_id?: string | null;
          refresh_secret_id?: string | null;
          tenant_id?: string;
          token_secret_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "metricool_connections_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: true;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      post_events: {
        Row: {
          actor: string | null;
          created_at: string;
          from_status: Database["public"]["Enums"]["post_status"] | null;
          id: number;
          note: string | null;
          post_id: string;
          tenant_id: string;
          to_status: Database["public"]["Enums"]["post_status"] | null;
        };
        ComputedFields: never;
        Insert: {
          actor?: string | null;
          created_at?: string;
          from_status?: Database["public"]["Enums"]["post_status"] | null;
          id?: number;
          note?: string | null;
          post_id: string;
          tenant_id: string;
          to_status?: Database["public"]["Enums"]["post_status"] | null;
        };
        Update: {
          actor?: string | null;
          created_at?: string;
          from_status?: Database["public"]["Enums"]["post_status"] | null;
          id?: number;
          note?: string | null;
          post_id?: string;
          tenant_id?: string;
          to_status?: Database["public"]["Enums"]["post_status"] | null;
        };
        Relationships: [
          {
            foreignKeyName: "post_events_post_same_tenant";
            columns: ["post_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "post_events_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      post_media: {
        Row: {
          duration_s: number | null;
          height: number | null;
          id: string;
          kind: string;
          position: number;
          post_id: string;
          storage_path: string;
          tenant_id: string;
          width: number | null;
        };
        ComputedFields: never;
        Insert: {
          duration_s?: number | null;
          height?: number | null;
          id?: string;
          kind: string;
          position?: number;
          post_id: string;
          storage_path: string;
          tenant_id: string;
          width?: number | null;
        };
        Update: {
          duration_s?: number | null;
          height?: number | null;
          id?: string;
          kind?: string;
          position?: number;
          post_id?: string;
          storage_path?: string;
          tenant_id?: string;
          width?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "post_media_post_same_tenant";
            columns: ["post_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "posts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "post_media_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      posts: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          attempts: number;
          caption: string | null;
          caption_provider: string | null;
          compliance_flags: string[];
          created_at: string;
          created_by: string | null;
          external_post_id: string | null;
          format: Database["public"]["Enums"]["post_format"];
          id: string;
          ig_account_id: string;
          ig_container_id: string | null;
          ig_media_id: string | null;
          is_ai_generated: boolean;
          last_checked_at: string | null;
          last_error: string | null;
          media_provider: string | null;
          next_attempt_at: string | null;
          origin: Database["public"]["Enums"]["post_origin"];
          permalink: string | null;
          publish_provider: Database["public"]["Enums"]["publish_provider"] | null;
          published_at: string | null;
          publishing_started_at: string | null;
          scheduled_at: string;
          status: Database["public"]["Enums"]["post_status"];
          tenant_id: string;
          theme: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          attempts?: number;
          caption?: string | null;
          caption_provider?: string | null;
          compliance_flags?: string[];
          created_at?: string;
          created_by?: string | null;
          external_post_id?: string | null;
          format: Database["public"]["Enums"]["post_format"];
          id?: string;
          ig_account_id: string;
          ig_container_id?: string | null;
          ig_media_id?: string | null;
          is_ai_generated?: boolean;
          last_checked_at?: string | null;
          last_error?: string | null;
          media_provider?: string | null;
          next_attempt_at?: string | null;
          origin?: Database["public"]["Enums"]["post_origin"];
          permalink?: string | null;
          publish_provider?: Database["public"]["Enums"]["publish_provider"] | null;
          published_at?: string | null;
          publishing_started_at?: string | null;
          scheduled_at: string;
          status?: Database["public"]["Enums"]["post_status"];
          tenant_id: string;
          theme: string;
          updated_at?: string;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          attempts?: number;
          caption?: string | null;
          caption_provider?: string | null;
          compliance_flags?: string[];
          created_at?: string;
          created_by?: string | null;
          external_post_id?: string | null;
          format?: Database["public"]["Enums"]["post_format"];
          id?: string;
          ig_account_id?: string;
          ig_container_id?: string | null;
          ig_media_id?: string | null;
          is_ai_generated?: boolean;
          last_checked_at?: string | null;
          last_error?: string | null;
          media_provider?: string | null;
          next_attempt_at?: string | null;
          origin?: Database["public"]["Enums"]["post_origin"];
          permalink?: string | null;
          publish_provider?: Database["public"]["Enums"]["publish_provider"] | null;
          published_at?: string | null;
          publishing_started_at?: string | null;
          scheduled_at?: string;
          status?: Database["public"]["Enums"]["post_status"];
          tenant_id?: string;
          theme?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "posts_ig_account_same_tenant";
            columns: ["ig_account_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "ig_accounts";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "posts_tenant_id_fkey";
            columns: ["tenant_id"];
            isOneToOne: false;
            referencedRelation: "tenants";
            referencedColumns: ["id"];
          },
        ];
      };
      tenants: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          plan: string;
          slug: string;
          status: Database["public"]["Enums"]["tenant_status"];
          timezone: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          plan?: string;
          slug: string;
          status?: Database["public"]["Enums"]["tenant_status"];
          timezone?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          plan?: string;
          slug?: string;
          status?: Database["public"]["Enums"]["tenant_status"];
          timezone?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      _drop_secret: { Args: { p_id: string }; Returns: undefined };
      _put_secret: { Args: { p_id: string; p_name: string; p_value: string }; Returns: string };
      accept_invitation: { Args: { p_token: string }; Returns: string };
      add_post_flags: { Args: { p_flags: string[]; p_post: string }; Returns: undefined };
      begin_generation: { Args: { p_note?: string; p_post: string }; Returns: undefined };
      claim_awaiting_confirmation: {
        Args: { p_every?: string; p_limit?: number };
        Returns: {
          approved_at: string | null;
          approved_by: string | null;
          attempts: number;
          caption: string | null;
          caption_provider: string | null;
          compliance_flags: string[];
          created_at: string;
          created_by: string | null;
          external_post_id: string | null;
          format: Database["public"]["Enums"]["post_format"];
          id: string;
          ig_account_id: string;
          ig_container_id: string | null;
          ig_media_id: string | null;
          is_ai_generated: boolean;
          last_checked_at: string | null;
          last_error: string | null;
          media_provider: string | null;
          next_attempt_at: string | null;
          origin: Database["public"]["Enums"]["post_origin"];
          permalink: string | null;
          publish_provider: Database["public"]["Enums"]["publish_provider"] | null;
          published_at: string | null;
          publishing_started_at: string | null;
          scheduled_at: string;
          status: Database["public"]["Enums"]["post_status"];
          tenant_id: string;
          theme: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "posts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      claim_due_posts: {
        Args: { p_limit?: number };
        Returns: {
          approved_at: string | null;
          approved_by: string | null;
          attempts: number;
          caption: string | null;
          caption_provider: string | null;
          compliance_flags: string[];
          created_at: string;
          created_by: string | null;
          external_post_id: string | null;
          format: Database["public"]["Enums"]["post_format"];
          id: string;
          ig_account_id: string;
          ig_container_id: string | null;
          ig_media_id: string | null;
          is_ai_generated: boolean;
          last_checked_at: string | null;
          last_error: string | null;
          media_provider: string | null;
          next_attempt_at: string | null;
          origin: Database["public"]["Enums"]["post_origin"];
          permalink: string | null;
          publish_provider: Database["public"]["Enums"]["publish_provider"] | null;
          published_at: string | null;
          publishing_started_at: string | null;
          scheduled_at: string;
          status: Database["public"]["Enums"]["post_status"];
          tenant_id: string;
          theme: string;
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "posts";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      delete_ig_token: { Args: { p_account: string }; Returns: undefined };
      delete_metricool_connection: { Args: { p_tenant: string }; Returns: undefined };
      finish_generation: { Args: { p_error?: string; p_post: string }; Returns: Database["public"]["Enums"]["post_status"] };
      finish_publish: {
        Args: { p_error?: string; p_ig_media_id?: string; p_outcome: string; p_permalink?: string; p_post: string; p_retry_at?: string };
        Returns: Database["public"]["Enums"]["post_status"];
      };
      has_tenant_role: { Args: { roles?: Database["public"]["Enums"]["member_role"][]; t: string }; Returns: boolean };
      invitation_preview: {
        Args: { p_token: string };
        Returns: {
          email: string;
          role: Database["public"]["Enums"]["member_role"];
          tenant_name: string;
          valid: boolean;
        }[];
      };
      is_platform_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      read_ai_key: { Args: { p_provider: string; p_tenant: string }; Returns: string };
      read_ig_token: { Args: { p_account: string }; Returns: string };
      read_metricool_credentials: {
        Args: { p_tenant: string };
        Returns: {
          auth_mode: string;
          client_id: string;
          client_secret: string;
          expires_at: string;
          refresh_token: string;
          token: string;
          user_id: string;
        }[];
      };
      read_platform_ai_key: { Args: { p_provider: string }; Returns: string };
      release_stuck_publishing: { Args: { p_older_than?: string }; Returns: number };
      review_post: { Args: { p_approve: boolean; p_note?: string; p_post: string }; Returns: Database["public"]["Enums"]["post_status"] };
      set_external_post: { Args: { p_external_id: string; p_post: string; p_provider: Database["public"]["Enums"]["publish_provider"] }; Returns: undefined };
      set_ig_container: { Args: { p_container: string; p_post: string }; Returns: undefined };
      set_metricool_tools: { Args: { p_tenant: string; p_tools: Json }; Returns: undefined };
      storage_tenant: { Args: { p_name: string }; Returns: string };
      store_ig_token: { Args: { p_account: string; p_expires_at: string; p_token: string }; Returns: undefined };
      store_metricool_oauth: {
        Args: { p_access: string; p_actor?: string; p_client_id: string; p_client_secret?: string; p_expires_at?: string; p_refresh?: string; p_tenant: string };
        Returns: undefined;
      };
      store_metricool_token: { Args: { p_actor?: string; p_tenant: string; p_token: string; p_user_id: string }; Returns: undefined };
      store_platform_ai_key: { Args: { p_actor?: string; p_key: string; p_provider: string }; Returns: undefined };
      tenant_members: {
        Args: { p_tenant: string };
        Returns: {
          created_at: string;
          email: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        }[];
      };
      transition_post: { Args: { p_note?: string; p_post: string; p_to: Database["public"]["Enums"]["post_status"] }; Returns: Database["public"]["Enums"]["post_status"] };
    };
    Enums: {
      ai_task: "caption" | "image" | "video" | "analysis";
      billing_mode: "platform" | "own";
      ig_account_status: "connected" | "needs_reauth" | "disconnected";
      job_status: "queued" | "running" | "succeeded" | "failed";
      member_role: "admin" | "editor" | "approver" | "viewer";
      post_format: "image" | "carousel" | "reels" | "story";
      post_origin: "ai" | "upload";
      post_status: "planned" | "generating" | "generation_failed" | "pending_approval" | "rejected" | "scheduled" | "publishing" | "published" | "failed" | "paused";
      publish_provider: "meta" | "metricool";
      tenant_status: "active" | "suspended";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] & DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ai_task: ["caption", "image", "video", "analysis"],
      billing_mode: ["platform", "own"],
      ig_account_status: ["connected", "needs_reauth", "disconnected"],
      job_status: ["queued", "running", "succeeded", "failed"],
      member_role: ["admin", "editor", "approver", "viewer"],
      post_format: ["image", "carousel", "reels", "story"],
      post_origin: ["ai", "upload"],
      post_status: ["planned", "generating", "generation_failed", "pending_approval", "rejected", "scheduled", "publishing", "published", "failed", "paused"],
      publish_provider: ["meta", "metricool"],
      tenant_status: ["active", "suspended"],
    },
  },
} as const;
