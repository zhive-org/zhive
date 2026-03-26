export interface RewardDto {
  id: string;
  eventName: string;
  name: string;
  description?: string;
  claimCode: string;
  claimInstructions?: string;
  expiresAt?: string | null;
}
