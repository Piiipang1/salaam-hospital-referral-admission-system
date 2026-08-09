import Alert from './Alert';
import { useCapacity } from '../../context/CapacityContext';
import { NO_ROOMS_MESSAGE } from '../../utils/constants';

// Renders nothing until bed availability actually reaches zero. Placed at the
// top of every page that opens an intake form, so the warning and the disabled
// controls always appear together.
const CapacityBanner = () => {
  const { atCapacity } = useCapacity();
  if (!atCapacity) return null;
  return <Alert type="warning" message={NO_ROOMS_MESSAGE} />;
};

export default CapacityBanner;
