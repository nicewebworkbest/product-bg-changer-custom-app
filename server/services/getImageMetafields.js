//require('isomorphic-fetch');
const Shopify = require('shopify-api-node');

const getImageMetafields = async (ctx, imgId) => {

	const { shop, accessToken } = ctx.session;

	const shopify = new Shopify({
		shopName: shop,
		accessToken : accessToken
	});

	return await shopify.metafield
		.list({
			metafield: { owner_resource: 'product_image', owner_id: imgId }
		});
};

module.exports = getImageMetafields;
