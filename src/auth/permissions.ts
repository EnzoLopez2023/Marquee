export const canDeleteDuplicates = (
  hasDeleteRole: boolean,
  hasFeatureEdit: boolean,
) => hasDeleteRole && hasFeatureEdit;

export const featureIsReadOnly = ({
  loading,
  duplicateFeature,
  hasDeleteRole,
  hasFeatureEdit,
}: {
  loading: boolean;
  duplicateFeature: boolean;
  hasDeleteRole: boolean;
  hasFeatureEdit: boolean;
}) => loading || (duplicateFeature
  ? !canDeleteDuplicates(hasDeleteRole, hasFeatureEdit)
  : !hasFeatureEdit);
