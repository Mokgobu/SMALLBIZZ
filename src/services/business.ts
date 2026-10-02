import { requireFirebase } from '../config/firebase'
import { doc, getDoc } from 'firebase/firestore'

export async function getUserBusinesses(userId: string){
  const { db } = requireFirebase()
  const userRef = doc(db, 'users', userId)
  const snap = await getDoc(userRef)
  if(!snap.exists()) return []
  const data = snap.data() as { businessId?: string | null; businesses?: string[] }
  return data.businessId ? [data.businessId] : data.businesses || []
}
