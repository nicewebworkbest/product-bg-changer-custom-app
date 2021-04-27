//require('isomorphic-fetch');
const Shopify = require('shopify-api-node');

const changeProductVariantImage = async (ctx, imgId, variantId) => {
	const { shop, accessToken } = ctx.session;

	const shopify = new Shopify({
		shopName: shop,
		accessToken : accessToken
	});

	await shopify.productVariant.update(variantId, { image_id: imgId });
};

module.exports = changeProductVariantImage;
