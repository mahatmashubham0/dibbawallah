export enum MealType {
  Breakfast = 'breakfast',
  Lunch = 'lunch',
  Dinner = 'dinner',
}

export enum VendorStatus {
  Active = 'active',
  Blocked = 'blocked',
}

export type VendorRecord = {
  id: number;
  businessName: string;
  locality: string;
  serviceAreas: string[];
  mealsOffered: MealType[];
  dialCode: string;
  mobile: string;
  upiId: string | null;
  inviteCode: string;
  status: VendorStatus;
  createdAt: Date;
  updatedAt: Date;
};
