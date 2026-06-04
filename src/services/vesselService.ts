import { db } from "../config/firebase";
import { doc, onSnapshot } from "firebase/firestore";

// Esta função "ouve" o barco em tempo real
export function watchVessel(vesselId: string, callback: (data: any) => void) {
  const vesselRef = doc(db, "telemetry", vesselId);

  return onSnapshot(vesselRef, (doc) => {
    if (doc.exists()) {
      callback(doc.data());
    }
  });
}
